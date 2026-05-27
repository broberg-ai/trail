// =====================================================================
// Trail — mock data + i18n strings
// =====================================================================

window.TRAIL_USER = {
  name: 'Sanne Andersen',
  email: 'mail@sanneandersen.dk',
  initials: 'SA',
};

window.TRAIL_TENANTS = [
  { slug: 'sanne-andersen',      name: 'Sanne Andersen',           plan: 'starter', neurons: 76,   trails: 1,  role: 'owner' },
  { slug: 'broberg-ai',          name: 'Broberg.ai',               plan: 'pro',     neurons: 412,  trails: 8,  role: 'admin' },
  { slug: 'webhouse',            name: 'WebHouse',                 plan: 'pro',     neurons: 1284, trails: 23, role: 'admin' },
  { slug: 'aalborg-zoneterapi',  name: 'Aalborg Zoneterapeutskole',plan: 'pro',     neurons: 891,  trails: 14, role: 'editor' },
  { slug: 'senti',               name: 'Senti',                    plan: 'hobby',   neurons: 12,   trails: 2,  role: 'editor' },
  { slug: 'dansk-institut-zt',   name: 'Dansk Institut for Zoneterapi', plan: 'pro', neurons: 2103, trails: 31, role: 'viewer' },
];

window.TRAIL_TRAILS_BY_TENANT = {
  'sanne-andersen': [
    { slug: 'sanne-andersen', name: 'Sanne Andersen', desc: 'Clinical zoneterapi material', neurons: 68, queue: 68, links: 3 },
  ],
  'broberg-ai': [
    { slug: 'product-wiki', name: 'Product wiki', desc: 'Engineering + product canon', neurons: 124, queue: 4, links: 0 },
    { slug: 'sales-playbook', name: 'Sales playbook', desc: 'Decks, scripts, comp pricing', neurons: 88, queue: 12, links: 1 },
    { slug: 'support-kb', name: 'Support KB', desc: 'Customer-facing answer set', neurons: 200, queue: 0, links: 0 },
  ],
  'webhouse': [
    { slug: 'engineering', name: 'Engineering', desc: 'Internal engineering wiki', neurons: 412, queue: 28, links: 6 },
    { slug: 'operations', name: 'Operations', desc: 'Ops runbooks + incident postmortems', neurons: 188, queue: 4, links: 2 },
  ],
};

window.TRAIL_RECENT_NEURONS = [
  { slug: 'sanne',           title: 'Sanne',                  trail: 'Sanne Andersen', tags: ['oversigt'] },
  { slug: 'nada-protokollen', title: 'NADA-protokollen',       trail: 'Sanne Andersen', tags: ['protokol'] },
  { slug: 'hjertechakraet',  title: 'Hjertechakraet',         trail: 'Sanne Andersen', tags: ['chakraer'] },
  { slug: 'fennikel',        title: 'Fennikel',               trail: 'Sanne Andersen', tags: ['urter'] },
  { slug: 'magnesium-002',   title: 'Magnesium',              trail: 'Sanne Andersen', tags: ['naturmedicin'] },
];

window.TRAIL_STRINGS = {
  en: {
    // login
    signInTitle: 'Sign in to Trail',
    signInSubtitle: 'Curate your knowledge. Chat against your brain.',
    signInCTA: 'Continue with Google',
    signInLoading: 'Redirecting to Google…',
    signInSplash: 'Signing you in…',
    signInError: 'Google denied the sign-in. Try again or contact support.',
    legal: 'Terms',
    privacy: 'Privacy',
    docs: 'Docs',

    // chrome
    search: 'Search neurons, trails, actions…',
    searchHint: 'Search or jump to…',
    cmd: '⌘K',

    // tenant switcher
    tenantSwitcherHeading: 'Switch tenant',
    tenantSearch: 'Filter tenants…',
    manageTenants: 'Manage tenants…',
    role: { owner: 'owner', admin: 'admin', editor: 'editor', viewer: 'viewer' },

    // user menu
    settings: 'Settings',
    theme: 'Theme',
    locale: 'Language',
    audio: 'Ambient audio',
    plan: 'Plan',
    upgrade: 'Upgrade →',
    signOut: 'Sign out',
    light: 'Light', dark: 'Dark', system: 'System',
    on: 'On', off: 'Off',
    neuronsOf: (used, cap) => `${used} / ${cap} neurons used`,

    // home
    trails: 'Trails',
    newTrail: 'New trail',
    serverNeurons: (n) => `${n} neurons on this trail-server`,
    emptyTrailsTitle: 'No trails yet',
    emptyTrailsBody: 'A trail is one knowledge-base inside this tenant. Upload sources, and Trail compiles them into linked neurons you can chat with.',
    emptyTrailsCTA: 'Create your first trail',
    emptyTenantsTitle: 'You don\'t have access to any tenants yet',
    emptyTenantsBody: 'Ask a teammate to invite you, or create your own tenant to get started.',
    emptyTenantsCTA: 'Create a tenant',
    emptyNeuronsTitle: 'Empty trail',
    emptyNeuronsBody: 'Drop in a PDF, paste an article, or import a source. Trail will compile it into linked neurons.',
    emptyNeuronsCTA: 'Add a source',

    // command palette
    cpRecent: 'Recent neurons',
    cpTrails: 'Trails',
    cpActions: 'Actions',
    cpTenants: 'Switch to tenant',
    cpEmpty: 'No matches',
    cpNavigate: 'navigate',
    cpSelect: 'open',
    cpClose: 'close',
  },
  da: {
    signInTitle: 'Log ind på Trail',
    signInSubtitle: 'Kurater din viden. Chat med din hjerne.',
    signInCTA: 'Fortsæt med Google',
    signInLoading: 'Omdirigerer til Google…',
    signInSplash: 'Logger dig ind…',
    signInError: 'Google afviste login. Prøv igen, eller kontakt support.',
    legal: 'Vilkår',
    privacy: 'Privatliv',
    docs: 'Dokumentation',

    search: 'Søg neuroner, trails, handlinger…',
    searchHint: 'Søg eller hop til…',
    cmd: '⌘K',

    tenantSwitcherHeading: 'Skift tenant',
    tenantSearch: 'Filtrér tenants…',
    manageTenants: 'Administrér tenants…',
    role: { owner: 'ejer', admin: 'admin', editor: 'redaktør', viewer: 'læser' },

    settings: 'Indstillinger',
    theme: 'Tema',
    locale: 'Sprog',
    audio: 'Ambient lyd',
    plan: 'Plan',
    upgrade: 'Opgradér →',
    signOut: 'Log ud',
    light: 'Lyst', dark: 'Mørkt', system: 'System',
    on: 'Til', off: 'Fra',
    neuronsOf: (used, cap) => `${used} / ${cap} neuroner brugt`,

    trails: 'Trails',
    newTrail: 'Ny trail',
    serverNeurons: (n) => `${n} neuroner på denne trail-server`,
    emptyTrailsTitle: 'Ingen trails endnu',
    emptyTrailsBody: 'En trail er én vidensbase inde i denne tenant. Upload kilder, og Trail kompilerer dem til linkede neuroner du kan chatte med.',
    emptyTrailsCTA: 'Opret din første trail',
    emptyTenantsTitle: 'Du har ingen tenant-adgang endnu',
    emptyTenantsBody: 'Bed en kollega om at invitere dig, eller opret din egen tenant for at komme i gang.',
    emptyTenantsCTA: 'Opret tenant',
    emptyNeuronsTitle: 'Tom trail',
    emptyNeuronsBody: 'Smid en PDF ind, indsæt en artikel, eller importér en kilde. Trail kompilerer den til linkede neuroner.',
    emptyNeuronsCTA: 'Tilføj kilde',

    cpRecent: 'Seneste neuroner',
    cpTrails: 'Trails',
    cpActions: 'Handlinger',
    cpTenants: 'Skift til tenant',
    cpEmpty: 'Ingen match',
    cpNavigate: 'naviger',
    cpSelect: 'åbn',
    cpClose: 'luk',
  },
};
