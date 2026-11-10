// Translate the live DSH SessionController model catalog to the official
// OpenFilm ACP option shape. This only handles public model metadata: never
// include credentials, account tokens, provider errors or raw configuration.
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && !value.includes('\0');
const modelValue = (provider, model) => Buffer.from(JSON.stringify([provider, model])).toString('base64url');

/** Build a display option and an internal lookup from a fresh Host catalog.
 * A value is valid for model selection only while present in this lookup.
 */
export function officialModelOptions(catalog) {
  if (!catalog || !Array.isArray(catalog.groups)) throw new TypeError('A DSH model catalog is required');
  const choices = new Map();
  const options = [];
  for (const group of catalog.groups) {
    if (!text(group?.id) || !text(group?.name) || !Array.isArray(group.models)) continue;
    for (const model of group.models) {
      if (!text(model?.id) || !text(model?.name)) continue;
      const value = modelValue(group.id, model.id);
      if (choices.has(value)) continue;
      choices.set(value, Object.freeze({ provider: group.id, model: model.id }));
      options.push({ value, name: `${group.name} / ${model.name}` });
      if (options.length >= 1024) break;
    }
    if (options.length >= 1024) break;
  }
  const configured = catalog.default;
  const current = text(configured?.provider) && text(configured?.model) ? modelValue(configured.provider, configured.model) : null;
  // A configured default absent from the catalog is not advertised as usable.
  const currentValue = current && choices.has(current) ? current : undefined;
  return {
    choices,
    option: { id: 'model', name: 'Model', category: 'model', type: 'select', ...(currentValue ? { currentValue } : {}), options },
  };
}
