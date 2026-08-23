import { h } from 'preact'
import { useState, useEffect, useCallback } from 'preact/hooks'

interface Config {
  serverUrl: string
  token: string
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
    chrome.storage.local.get(['serverUrl', 'token'], (result) => {
      resolve({
        serverUrl: result.serverUrl || DEFAULT_SERVER,
        token: result.token || DEFAULT_TOKEN,
      })
    })
  })
}

function saveConfig(config: Config): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set(
      { serverUrl: config.serverUrl, token: config.token },
      () => resolve()
    )
  })
}

async function fetchKnowledgeBases(serverUrl: string, token: string): Promise<KnowledgeBase[]> {
  // F208.1 — "could not reach it" and "it refused me" are different problems
  // with different fixes, and the popup used to show neither. A wrong port and
  // a dead token looked identical: an empty panel saying "Not configured".
  let res: Response
  try {
    res = await fetch(`${serverUrl}/api/v1/knowledge-bases`, {
      headers: { Authorization: `Bearer ${token}` },
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
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body: bodyBytes,
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

  useEffect(() => {
    if (config?.token && config.serverUrl) {
      fetchKnowledgeBases(config.serverUrl, config.token)
        .then((result) => {
          setKbs(result)
          setConnError(null)
          if (result.length === 1) setSelectedKb(result[0].id)
        })
        .catch((err: Error) => {
          setConnError(err.message)
        })
    }
  }, [config])

  const handleSaveSettings = useCallback(async () => {
    const newConfig = { serverUrl: tempServerUrl, token: tempToken }
    await saveConfig(newConfig)
    setConfig(newConfig)
    setShowSettings(false)
    setKbs([])
    setSelectedKb('')
    fetchKnowledgeBases(newConfig.serverUrl, newConfig.token)
      .then((result) => {
        setKbs(result)
        if (result.length === 1) setSelectedKb(result[0].id)
      })
      .catch((err) => {
        setToast({ type: 'error', message: `Could not connect: ${err.message}` })
      })
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
  }, [config, selectedKb, tags])

  if (!config) {
    return h('div', { class: 'status-bar' }, [
      h('div', { class: 'spinner' }),
      'Loading...',
    ])
  }

  const isConnected = !!config.token && kbs.length > 0
  const canClip = isConnected && selectedKb && clipState !== 'uploading' && clipState !== 'extracting'

  return h('div', {}, [
    h('div', { class: 'header' }, [
      h('div', { class: 'header-logo' }),
      h('h1', {}, 'Trail Clipper'),
    ]),

    h('div', { class: 'section' }, [
      h('div', { class: 'section-title' }, 'Knowledge Base'),
      h('select',
        {
          value: selectedKb,
          onChange: (e: Event) => setSelectedKb((e.target as HTMLSelectElement).value),
          disabled: !isConnected,
        },
        [
          h('option', { value: '' }, kbs.length === 0 ? 'No KBs found' : 'Select a KB...'),
          ...kbs.map((kb) =>
            h('option', { value: kb.id }, kb.name)
          ),
        ]
      ),
    ]),

    h('div', { class: 'section' }, [
      h('div', { class: 'section-title' }, 'Tags (optional)'),
      h('input', {
        type: 'text',
        value: tags,
        onInput: (e) => setTags((e.target as HTMLInputElement).value),
        placeholder: 'e.g. research, article, ai',
      }),
    ]),

    h('button',
      {
        class: 'btn btn-primary',
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

    h('div', { class: 'status-bar' }, [
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

    h('div', { class: 'settings-toggle', onClick: () => setShowSettings(!showSettings) },
      showSettings ? 'Hide settings' : 'Settings'
    ),

    showSettings && h('div', { class: 'settings-panel' }, [
      h('div', { class: 'input-group' }, [
        h('div', { class: 'input-row' }, [
          h('label', {}, 'Server URL'),
          h('input', {
            type: 'text',
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
          onClick: () => setTempServerUrl(CLOUD_SERVER),
          disabled: tempServerUrl === CLOUD_SERVER,
        }, 'Use cloud'),
        h('button', {
          class: 'btn',
          onClick: () => setTempServerUrl(LOCAL_SERVER),
          disabled: tempServerUrl === LOCAL_SERVER,
        }, 'Use local'),
      ]),
      h('div', { class: 'btn-group' }, [
        h('button', { class: 'btn btn-primary', onClick: handleSaveSettings }, 'Save & Connect'),
      ]),
    ]),
  ])
}
