// Read a JSON body with a hard size cap.
//
// Returns {} for anything that is not a small JSON object, so handlers validate
// one shape instead of three (empty, oversized, malformed).
export async function readJsonBody(req, limit = 8192) {
  try {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
      if (Buffer.concat(chunks).byteLength > limit) return {};
    }
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}
