import { h } from 'preact'
import { useState, useEffect, useCallback } from 'preact/hooks'
// F086 + house rule: no native <select>. It cannot be styled, ignores the
// design system, and renders as a macOS system control inside a dark panel.
// Shared with the onboarding app so the keyboard + ARIA behaviour has one
// implementation rather than two that drift.
import { BauhausSelect } from '@trail/ui'

interface Config {
  serverUrl: string
  token: string
  /** F215.1 — the tenant the last clip went to. Re-validated on open. */
  tenant: string
}

interface Tenant {
  slug: string
  name: string
  home: boolean
}

interface KnowledgeBase {
  id: string
  name: string
  slug: string
  description: string | null
}

type ClipState = 'idle' | 'extracting' | 'uploading' | 'success' | 'error'

// F208.1 — the cloud is the default. Pointing at the dev server meant a clip
// was lost whenever the Mac happened to be off, and for anyone but its author
// the extension pointed at nothing at all. The local server stays one click
// away in settings.
const CLOUD_SERVER = 'https://app.trailmem.com'
const LOCAL_SERVER = 'http://127.0.0.1:58031'
const DEFAULT_SERVER = CLOUD_SERVER
// F207 — no default token, on purpose. There used to be a real full-access
// Trail key here, in a PUBLIC repo. An empty token means "not configured yet",
// which the UI says out loud rather than failing with an opaque 401.
const DEFAULT_TOKEN = ''

function loadConfig(): Promise<Config> {
  return new Promise((resolve) => {
    chrome.storage.local.get(['serverUrl', 'token', 'tenant'], (result) => {
      resolve({
        serverUrl: result.serverUrl || DEFAULT_SERVER,
        token: result.token || DEFAULT_TOKEN,
        tenant: result.tenant || '',
      })
    })
  })
}

function saveConfig(config: Config): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set(
      { serverUrl: config.serverUrl, token: config.token, tenant: config.tenant },
      () => resolve()
    )
  })
}

/**
 * F215.1 — which tenants may this key select? Answered by the control plane
 * from the SAME membership set the proxy enforces, so the picker cannot offer
 * a slug that would be refused at clip time.
 */
async function fetchTenants(serverUrl: string, token: string): Promise<Tenant[]> {
  let res: Response
  try {
    res = await fetch(`${serverUrl}/api/v1/me/tenants`, {
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'omit',
    })
  } catch {
    throw new Error(`Can't reach ${serverUrl} — is it running, and is the address right?`)
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error(`${serverUrl} refused the API token (${res.status}). Check the token in settings.`)
  }
  // An older server has no such route. That is not a reason to refuse to clip:
  // fall back to "one tenant, no picker", which is exactly how the extension
  // behaved before this feature.
  if (res.status === 404) return []
  if (!res.ok) throw new Error(`${serverUrl} answered ${res.status} ${res.statusText}`)
  const body = (await res.json()) as { tenants?: Tenant[] }
  return Array.isArray(body.tenants) ? body.tenants : []
}

/**
 * Headers for a tenant-scoped call. An empty slug sends no header, so the
 * server falls back to the key's home tenant — the pre-F215.1 behaviour.
 *
 * F215.4 — every call in this file also sets `credentials: 'omit'`. The Clipper
 * holds host_permissions for the Trail origin, so without it Chrome attaches
 * the signed-in user's app.trailmem.com cookies, and the server used to let
 * that ambient session outrank the key: the picker said Broberg.ai and the
 * request went to whichever customer the browser tab was last looking at. The
 * Clipper acts as its KEY and has no business carrying a browser session.
 * Do not remove it — the server-side fix and this one guard the same hole from
 * opposite ends.
 */
function authHeaders(token: string, tenant: string): Record<string, string> {
  const h: Record<string, string> = { Authorization: `Bearer ${token}` }
  if (tenant) h['X-Trail-Tenant'] = tenant
  return h
}

async function fetchKnowledgeBases(
  serverUrl: string,
  token: string,
  tenant: string,
): Promise<KnowledgeBase[]> {
  // F208.1 — "could not reach it" and "it refused me" are different problems
  // with different fixes, and the popup used to show neither. A wrong port and
  // a dead token looked identical: an empty panel saying "Not configured".
  let res: Response
  try {
    res = await fetch(`${serverUrl}/api/v1/knowledge-bases`, {
      headers: authHeaders(token, tenant),
      credentials: 'omit',
    })
  } catch {
    throw new Error(`Can't reach ${serverUrl} — is it running, and is the address right?`)
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error(`${serverUrl} refused the API token (${res.status}). Check the token in settings.`)
  }
  if (!res.ok) throw new Error(`${serverUrl} answered ${res.status} ${res.statusText}`)
  return res.json()
}

async function uploadClip(
  serverUrl: string,
  token: string,
  tenant: string,
  kbId: string,
  title: string,
  content: string,
  url: string,
  tags: string
): Promise<{ id: string }> {
  const boundary = '----TrailWebClipperBoundary'
  const filename = `${title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.md`
  const tagsArray = tags
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)

  const metadata = JSON.stringify({
    sourceUrl: url,
    clippedAt: new Date().toISOString(),
    connector: 'web-clipper',
    tags: tagsArray,
  })

  const parts = [
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: text/markdown\r\n\r\n${content}\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n${metadata}\r\n`,
    `--${boundary}--\r\n`,
  ]

  const body = parts.join('')
  const encoder = new TextEncoder()
  const bodyBytes = encoder.encode(body)

  const res = await fetch(`${serverUrl}/api/v1/knowledge-bases/${kbId}/documents/upload`, {
    method: 'POST',
    headers: {
      ...authHeaders(token, tenant),
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body: bodyBytes,
    credentials: 'omit',
  })

  if (!res.ok) {
    const errorText = await res.text()
    throw new Error(`Upload failed (${res.status}): ${errorText}`)
  }

  return res.json()
}

async function extractFromTab(tabId: number): Promise<{ title: string; content: string }> {
  // F208.2 — the extractor is no longer DECLARED in the manifest (it used to
  // register on every page the user visits, at document_idle). It is built to a
  // fixed path and injected on click, so the path is a constant rather than a
  // manifest lookup — reading content_scripts here would now throw.
  const contentScriptPath = 'content/extractor.js'

  // Try sending to existing content script first
  try {
    const result = await chrome.tabs.sendMessage(tabId, { action: 'extract' })
    if (result && result.content) return result
  } catch {
    // Content script not loaded — inject it
  }

  // Inject content script dynamically
  await chrome.scripting.executeScript({
    target: { tabId },
    files: [contentScriptPath],
  })

  // Retry with exponential backoff (content script needs time to register listener)
  const delays = [300, 500, 1000]
  for (const delay of delays) {
    await new Promise((r) => setTimeout(r, delay))
    try {
      const result = await chrome.tabs.sendMessage(tabId, { action: 'extract' })
      if (result && result.content) return result
    } catch {
      // Continue retrying
    }
  }

  throw new Error('Content script did not respond — try refreshing the page')
}

export function Popup() {
  const [config, setConfig] = useState<Config | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [kbs, setKbs] = useState<KnowledgeBase[]>([])
  const [selectedKb, setSelectedKb] = useState('')
  // F215.1 — the tenant picker. `tenants` is [] when the server has no such
  // route (older build) or the key spans exactly one tenant; the picker is
  // hidden in both cases, so a single-tenant user sees no change at all.
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [selectedTenant, setSelectedTenant] = useState('')
  const [tags, setTags] = useState('')
  const [clipState, setClipState] = useState<ClipState>('idle')
  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null)
  const [clippedUrl, setClippedUrl] = useState('')
  const [tempServerUrl, setTempServerUrl] = useState('')
  const [tempToken, setTempToken] = useState('')
  // F208.1 — why we are not connected, in words the user can act on.
  const [connError, setConnError] = useState<string | null>(null)

  useEffect(() => {
    loadConfig().then((cfg) => {
      setConfig(cfg)
      setTempServerUrl(cfg.serverUrl)
      setTempToken(cfg.token)
    })
  }, [])

  // Resolve which tenant we are clipping into BEFORE asking for its Trails.
  // A remembered tenant is re-validated against the live list: a membership
  // that has been revoked must fall back visibly here, not fail at clip time
  // when the user has already chosen a Trail and pressed the button.
  useEffect(() => {
    if (!config?.token || !config.serverUrl) return
    let cancelled = false
    fetchTenants(config.serverUrl, config.token)
      .then((list) => {
        if (cancelled) return
        setTenants(list)
        setConnError(null)
        const remembered = list.find((t) => t.slug === config.tenant)
        if (config.tenant && !remembered && list.length > 0) {
          setToast({
            type: 'info',
            message: `You no longer have access to "${config.tenant}" — switched to ${(list.find((t) => t.home) ?? list[0]).name}.`,
          })
        }
        setSelectedTenant(remembered?.slug ?? (list.find((t) => t.home) ?? list[0])?.slug ?? '')
      })
      .catch((err: Error) => {
        if (!cancelled) setConnError(err.message)
      })
    return () => {
      cancelled = true
    }
  }, [config])

  useEffect(() => {
    if (!config?.token || !config.serverUrl) return
    // Wait for the tenant to be resolved when there IS one to resolve —
    // otherwise the first KB fetch races the tenant list and lists the home
    // tenant's Trails under the remembered tenant's name.
    if (tenants.length > 0 && !selectedTenant) return
    let cancelled = false
    fetchKnowledgeBases(config.serverUrl, config.token, selectedTenant)
      .then((result) => {
        if (cancelled) return
        setKbs(result)
        setConnError(null)
        setSelectedKb(result.length === 1 ? result[0].id : '')
      })
      .catch((err: Error) => {
        if (!cancelled) setConnError(err.message)
      })
    return () => {
      cancelled = true
    }
  }, [config, selectedTenant, tenants.length])

  // Clearing the KB is not tidiness — it is the guard against clipping into
  // the wrong customer. A KB id belongs to ONE tenant; sent with a different
  // tenant header it 404s at best, and at worst matches something in the new
  // tenant while the Clipper reports success. Cleared here, synchronously,
  // rather than waiting for the new list to arrive.
  const handleTenantChange = useCallback(
    (slug: string) => {
      if (slug === selectedTenant) return
      setSelectedKb('')
      setKbs([])
      setSelectedTenant(slug)
      if (config) {
        const next = { ...config, tenant: slug }
        void saveConfig(next)
      }
    },
    [selectedTenant, config],
  )

  const handleSaveSettings = useCallback(async () => {
    // A different server (or token) means a different set of tenants, so the
    // remembered slug cannot carry over — it would be re-validated against a
    // list it was never in and produce a confusing "no longer have access".
    const newConfig = { serverUrl: tempServerUrl, token: tempToken, tenant: '' }
    await saveConfig(newConfig)
    setConfig(newConfig)
    setShowSettings(false)
    setKbs([])
    setSelectedKb('')
    setTenants([])
    setSelectedTenant('')
  }, [tempServerUrl, tempToken])

  const handleClip = useCallback(async () => {
    if (!config || !selectedKb) return

    setClipState('extracting')
    setToast(null)

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab.id) throw new Error('No active tab')

      setClippedUrl(tab.url || '')

      const extracted = await extractFromTab(tab.id)

      setClipState('uploading')

      const frontmatter = `---\ntitle: ${extracted.title}\nsource: ${tab.url}\nclippedAt: ${new Date().toISOString()}\n${tags ? `tags: [${tags.split(',').map((t) => t.trim()).join(', ')}]\n` : ''}---\n\n`

      await uploadClip(
        config.serverUrl,
        config.token,
        selectedTenant,
        selectedKb,
        extracted.title,
        frontmatter + extracted.content,
        tab.url || '',
        tags
      )

      setClipState('success')
      setToast({ type: 'success', message: `Clipped "${extracted.title}" to Trail` })
    } catch (err) {
      setClipState('error')
      setToast({ type: 'error', message: err instanceof Error ? err.message : 'Unknown error' })
    }
  }, [config, selectedKb, selectedTenant, tags])

  if (!config) {
    return h('div', { class: 'status-bar' }, [
      h('div', { class: 'spinner' }),
      'Loading...',
    ])
  }

  const isConnected = !!config.token && kbs.length > 0
  const canClip = isConnected && selectedKb && clipState !== 'uploading' && clipState !== 'extracting'

  return h('div', { 'data-testid': 'clipper-root' }, [
    h('div', { class: 'header' }, [
      h('div', { class: 'header-logo' }),
      h('h1', {}, 'Trail Clipper'),
    ]),

    // Ship dark for single-tenant keys: no picker when there is nothing to
    // pick. `tenants` is [] on an older server too, so the extension keeps
    // working against a build that has no /me/tenants route.
    tenants.length > 1
      ? h('div', { class: 'section' }, [
          h('div', { class: 'section-title' }, 'Tenant'),
          h(BauhausSelect, {
            value: selectedTenant,
            testid: 'clipper-tenant-select',
            class: 'clipper-select',
            ariaLabel: 'Tenant',
            onChange: handleTenantChange,
            options: tenants.map((t) => ({ value: t.slug, label: t.name })),
          }),
        ])
      : null,

    h('div', { class: 'section' }, [
      h('div', { class: 'section-title' }, 'Knowledge Base'),
      h(BauhausSelect, {
        value: selectedKb,
        testid: 'clipper-kb-select',
        class: 'clipper-select',
        ariaLabel: 'Knowledge base',
        onChange: (v: string) => setSelectedKb(v),
        options: [
          { value: '', label: kbs.length === 0 ? 'No KBs found' : 'Select a KB…' },
          ...kbs.map((kb) => ({ value: kb.id, label: kb.name })),
        ],
      }),
    ]),

    h('div', { class: 'section' }, [
      h('div', { class: 'section-title' }, 'Tags (optional)'),
      h('input', {
        type: 'text',
        'data-testid': 'clipper-tags-input',
        value: tags,
        onInput: (e) => setTags((e.target as HTMLInputElement).value),
        placeholder: 'e.g. research, article, ai',
      }),
    ]),

    h('button',
      {
        class: 'btn btn-primary',
        'data-testid': 'clipper-clip-button',
        disabled: !canClip,
        onClick: handleClip,
      },
      clipState === 'extracting'
        ? 'Extracting...'
        : clipState === 'uploading'
          ? 'Uploading to Trail...'
          : 'Clip to Trail'
    ),

    clippedUrl && h('div', { class: 'clipped-url' }, `Source: ${clippedUrl}`),

    toast && h('div', { class: `toast toast-${toast.type}` }, toast.message),

    h('div', { class: 'status-bar', 'data-testid': 'clipper-status-bar' }, [
      isConnected
        ? h('div', { class: 'connected-dot' })
        : h('div', { class: 'disconnected-dot' }),
      isConnected
        ? `${kbs.length} KB(s) · ${config.serverUrl.replace(/^https?:\/\//, '')}`
        : connError
          ? 'Not connected'
          : 'Not configured — add your API token in settings',
    ]),

    // F208.1 — the actual reason, not a silent empty panel.
    connError && h('div', { class: 'conn-error' }, connError),

    h('div', { class: 'settings-toggle', 'data-testid': 'clipper-settings-toggle', role: 'button', tabIndex: 0, onClick: () => setShowSettings(!showSettings) },
      showSettings ? 'Hide settings' : 'Settings'
    ),

    showSettings && h('div', { class: 'settings-panel' }, [
      h('div', { class: 'input-group' }, [
        h('div', { class: 'input-row' }, [
          h('label', {}, 'Server URL'),
          h('input', {
            type: 'text',
            'data-testid': 'clipper-server-url-input',
            value: tempServerUrl,
            onInput: (e) => setTempServerUrl((e.target as HTMLInputElement).value),
            placeholder: CLOUD_SERVER,
          }),
        ]),
      ]),
      h('div', { class: 'input-group' }, [
        h('div', { class: 'input-row' }, [
          h('label', {}, 'API Token'),
          h('input', {
            type: 'password',
            'data-testid': 'clipper-api-token-input',
            value: tempToken,
            onInput: (e) => setTempToken((e.target as HTMLInputElement).value),
            placeholder: 'trail_xxx',
          }),
        ]),
      ]),
      // F208.1 — the two servers anyone actually uses, one click each. Typing a
      // URL by hand is where a trailing slash or a wrong port silently costs an
      // afternoon.
      h('div', { class: 'btn-group' }, [
        h('button', {
          class: 'btn',
          'data-testid': 'clipper-use-cloud-button',
          onClick: () => setTempServerUrl(CLOUD_SERVER),
          disabled: tempServerUrl === CLOUD_SERVER,
        }, 'Use cloud'),
        h('button', {
          class: 'btn',
          'data-testid': 'clipper-use-local-button',
          onClick: () => setTempServerUrl(LOCAL_SERVER),
          disabled: tempServerUrl === LOCAL_SERVER,
        }, 'Use local'),
      ]),
      h('div', { class: 'btn-group' }, [
        h('button', { class: 'btn btn-primary', 'data-testid': 'clipper-save-connect-button', onClick: handleSaveSettings }, 'Save & Connect'),
      ]),
    ]),
  ])
}
