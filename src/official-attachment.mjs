// Injectable browser transport for the official composer's binary attachments.
// A failed response or connection may arrive after Studio committed the file.
function uploadAttachment(projectId, name, bytes) {
  const q = new URLSearchParams({ projectId, name });
  return (async () => {
    let response;
    try {
      response = await fetch('/__dsh/official-upload?' + q, { method: 'PUT', credentials: 'same-origin', headers: { 'content-type': 'application/octet-stream' }, body: bytes });
    } catch {
      throw new Error('附件上传连接失败，文件可能已导入，请先检查项目素材后再重试。');
    }
    if (response.status === 413) throw new Error('附件超过 256 MiB 上限，请选择较小的文件。');
    if (response.status === 422) throw new Error('文件已导入但无法读取，请检查素材，避免重复上传。');
    if (!response.ok) throw new Error('附件上传暂不可用，文件可能已导入，请先检查项目素材后再重试。');
    try { return await response.json(); }
    catch { throw new Error('附件上传结果无法读取，文件可能已导入，请先检查项目素材后再重试。'); }
  })();
}

export const officialUploadSource = `(${uploadAttachment.toString()})`;
