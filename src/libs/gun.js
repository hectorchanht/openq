import Gun from 'gun/gun';
// NOTE: 'gun/sea' is deliberately NOT imported anymore — Gun user
// accounts (username+password keypairs) were retired in favour of the
// Dawn standard email sign-in (see src/libs/auth.js + worker/). The
// graph itself is unchanged: queues, votes and pages are plain nodes.

// Public community relays come and go; Gun's mesh syncs with whichever
// peers are reachable, so list several and override with your own relays
// via the NEXT_PUBLIC_GUN_PEERS env var (comma-separated URLs).
const DEFAULT_PEERS = [
  'https://gun.defucc.io/gun',
  'https://peer.wallie.io/gun',
  'https://shogun-relay.peer.ooo/gun',
  'https://e2eca.herokuapp.com/gun',
];

const peers = (process.env.NEXT_PUBLIC_GUN_PEERS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const gun = Gun({
  peers: peers.length ? peers : DEFAULT_PEERS,
});

export default gun;
