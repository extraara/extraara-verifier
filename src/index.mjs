import { verifyCertificate as verifyRecordBytes, MAX_CERTIFICATE_BYTES } from './verifier.mjs';
import { verifyBundle as verifyPackageBytes, PACKAGE_VERSION } from './bundle.mjs';

export { MAX_CERTIFICATE_BYTES, PACKAGE_VERSION };
export const MAX_DOCUMENT_BYTES = 64 * 1024 * 1024;

function validateBytes(value, maximum, name) {
  if (!(value instanceof Uint8Array) || value.byteLength > maximum) {
    throw new TypeError(name + ' must be a Uint8Array within the supported size limit.');
  }
}

function validateOptions(options, allowed) {
  if (
    options === null ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    Object.keys(options).some((key) => !allowed.includes(key))
  ) {
    throw new TypeError('Unsupported verification options.');
  }
  const pins = options.trustedKeyIDs ?? [];
  if (
    !Array.isArray(pins) ||
    pins.length > 256 ||
    new Set(pins).size !== pins.length ||
    pins.some((pin) => typeof pin !== 'string' || !/^[a-f0-9]{64}$/.test(pin))
  ) {
    throw new TypeError('Trusted keys must be distinct lowercase SHA-256 fingerprints.');
  }
}

export function verifyCertificate(recordBytes, options = {}) {
  validateBytes(recordBytes, MAX_CERTIFICATE_BYTES, 'Record');
  validateOptions(options, ['fileBytes', 'trustedKeyIDs']);
  if (options.fileBytes !== undefined) {
    validateBytes(options.fileBytes, MAX_DOCUMENT_BYTES, 'Document');
  }
  return verifyRecordBytes(Buffer.from(recordBytes), options);
}

export function verifyBundle(manifestBytes, recordBytes, documentBytes, options = {}) {
  validateBytes(manifestBytes, 128 * 1024, 'Manifest');
  validateBytes(recordBytes, MAX_CERTIFICATE_BYTES, 'Record');
  if (documentBytes !== undefined) {
    validateBytes(documentBytes, MAX_DOCUMENT_BYTES, 'Document');
  }
  validateOptions(options, ['trustedKeyIDs', 'policy']);
  return verifyPackageBytes(manifestBytes, recordBytes, documentBytes, options);
}
