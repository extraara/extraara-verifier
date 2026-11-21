import { openSync, closeSync, fstatSync, readSync, constants } from 'node:fs';

export function readRegularFile(path, maximum) {
  const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);
  const descriptor = openSync(path, flags);
  try {
    const before = fstatSync(descriptor, { bigint: true });
    if (!before.isFile() || before.size > BigInt(maximum)) {
      throw new Error('Input must be a regular file within the supported size limit.');
    }
    const data = Buffer.alloc(Number(before.size) + 1);
    let length = 0;
    while (length < data.length) {
      const count = readSync(descriptor, data, length, data.length - length, null);
      if (count === 0) break;
      length += count;
    }
    const after = fstatSync(descriptor, { bigint: true });
    if (
      length !== Number(before.size) ||
      after.size !== before.size ||
      after.mtimeNs !== before.mtimeNs ||
      after.ctimeNs !== before.ctimeNs
    ) {
      throw new Error('Input changed while being read.');
    }
    return data.subarray(0, length);
  } finally {
    closeSync(descriptor);
  }
}
