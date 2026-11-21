import { createHash, createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
export const digest = (data) => createHash('sha256').update(data).digest('hex');
const encode = (x) => Buffer.from(JSON.stringify(x));
const u64 = (n) => {
  const x = Buffer.alloc(8);
  x.writeBigUInt64BE(BigInt(n));
  return x;
};
export function makeFixture({
  count = 3,
  bound = true,
  observations,
  alterHeader,
  alterPayload,
  alterEnvelope,
  rawPayload,
  signingKey,
} = {}) {
  const { privateKey, publicKey } = signingKey
    ? { privateKey: signingKey, publicKey: createPublicKey(signingKey) }
    : generateKeyPairSync('ed25519');
  const rawKey = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url');
  const document = Buffer.from('Synthetic interoperability fixture. No real writing evidence.\n');
  const header = {
    protocolVersion: 'extraproof/1',
    sessionID: 'b5fef8ec-9180-4fa9-a999-620cbde14922',
    startedAtMilliseconds: 1000,
    targetBundleID: 'de.extraproof.synthetic',
    mode: 'observation',
    assurance: 'localObservation',
    synthetic: true,
    recorderVersion: '1.0.0',
  };
  alterHeader?.(header);
  const headerBytes = encode(header);
  let head = digest(Buffer.concat([Buffer.from('ExtraProof.Session.v1\0'), headerBytes]));
  const events = [];
  for (let i = 0; i < (observations?.length ?? count); i++) {
    const bodyBytes = encode(
      observations
        ? observations[i]
        : {
            kind: 'input.summary',
            timestampMilliseconds: 1100 + i,
            monotonicNanoseconds: String(100_000 + i),
            metadata: { synthetic: 'true', correlated: '1' },
          },
    );
    const next = digest(
      Buffer.concat([
        Buffer.from('ExtraProof.Event.v1\0'),
        Buffer.from(head, 'hex'),
        u64(i),
        u64(bodyBytes.length),
        bodyBytes,
      ]),
    );
    events.push({
      sequence: i,
      body: bodyBytes.toString('base64'),
      previousHash: head,
      hash: next,
    });
    head = next;
  }
  const completion = {
    endedAtMilliseconds: Math.max(
      2000,
      ...(observations ?? []).map((x) => x.timestampMilliseconds),
    ),
    status: 'completed',
  };
  if (bound)
    completion.fileBinding = {
      sha256: digest(document),
      byteCount: document.length,
      fileName: 'synthetic.txt',
    };
  const payload = { header: headerBytes.toString('base64'), events, headHash: head, completion };
  alterPayload?.(payload);
  const payloadBytes = rawPayload ? Buffer.from(rawPayload(payload)) : encode(payload);
  const envelope = {
    schemaVersion: 'extraproof/1',
    algorithm: 'Ed25519',
    keyID: digest(rawKey),
    publicKey: rawKey.toString('base64'),
    payload: payloadBytes.toString('base64'),
    signature: sign(
      null,
      Buffer.concat([Buffer.from('ExtraProof.Certificate.v1\0'), payloadBytes]),
      privateKey,
    ).toString('base64'),
  };
  alterEnvelope?.(envelope);
  return { bytes: encode(envelope), envelope, header, document, payload, privateKey };
}
