const fs = require('fs');
const path = require('path');

const BODY_FILE_MAX_BYTES = 64 * 1024;

const truncateUtf8 = (value, maxBytes = BODY_FILE_MAX_BYTES) => {
  const bytes = Buffer.from(String(value ?? ''), 'utf8');
  if (bytes.length <= maxBytes) return bytes.toString('utf8');

  // If the byte immediately after the cap is a continuation byte, the cap
  // splits a multi-byte character. Drop that entire character rather than
  // writing a replacement character to the staged body.
  let end = maxBytes;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
  return bytes.subarray(0, end).toString('utf8');
};

const stagePrBody = (body, runnerTemp, fileName = 'changelog-pr-body.md') => {
  if (!runnerTemp) throw new Error('RUNNER_TEMP is not set');

  const sanitized = String(body ?? '').replace(/\u0000/g, '');
  const content = truncateUtf8(sanitized);
  const filePath = path.join(runnerTemp, fileName);

  fs.writeFileSync(filePath, content, { encoding: 'utf8', mode: 0o600 });
  fs.chmodSync(filePath, 0o600);

  return {
    path: filePath,
    originalBytes: Buffer.byteLength(sanitized, 'utf8'),
    writtenBytes: Buffer.byteLength(content, 'utf8'),
    truncated: content !== sanitized,
  };
};

module.exports = { BODY_FILE_MAX_BYTES, stagePrBody, truncateUtf8 };
