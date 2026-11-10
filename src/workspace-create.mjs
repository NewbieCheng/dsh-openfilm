/**
 * Create a DSH workspace, not an OpenFilm project.
 *
 * Call this only after the user has explicitly confirmed the parent and name.
 * `createdPath` resumes a previous attempt without creating the directory again.
 * The injected createDirectory must fail if the target already exists; it must
 * not overwrite or reuse an existing directory.
 */
export async function createWorkspaceFlow(
  { pickDirectory, createDirectory, registerWorkspace, connectWorkspace, refreshSessions },
  { parent, name, createdPath } = {},
) {
  let path = typeof createdPath === 'string' ? createdPath : undefined;
  let workspace;
  let session;
  let stage = 'validate';

  try {
    if (path !== undefined && !path.trim()) {
      throw new Error('The created workspace path is empty.');
    }
    if (!path) {
      if (typeof name !== 'string' || !name.trim() || name !== name.trim() ||
          name === '.' || name === '..' || /[\\/\x00-\x1f<>:"|?*]/.test(name) ||
          /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
        throw new Error('Enter a valid directory name.');
      }
      stage = 'pickDirectory';
      const selectedParent = parent ?? await pickDirectory();
      if (selectedParent == null) return { status: 'cancelled' };
      if (typeof selectedParent !== 'string' || !selectedParent.trim()) {
        throw new Error('Select a parent directory.');
      }
      stage = 'createDirectory';
      path = await createDirectory(selectedParent, name);
      if (typeof path !== 'string' || !path.trim()) {
        path = undefined;
        throw new Error('Directory creation returned no path.');
      }
    }

    stage = 'registerWorkspace';
    workspace = await registerWorkspace({ path });
    if (!workspace || !workspace.workspaceId) {
      throw new Error('Workspace registration returned no workspace ID.');
    }
    stage = 'connectWorkspace';
    session = await connectWorkspace(workspace.workspaceId);
    if (!session) throw new Error('Workspace connection returned no session.');
    stage = 'refreshSessions';
    await refreshSessions();
    return { status: 'success', path, workspace, session };
  } catch (error) {
    return { status: 'failed', stage, error, ...(path ? { createdPath: path } : {}),
      ...(workspace ? { workspace } : {}), ...(session ? { session } : {}) };
  }
}
