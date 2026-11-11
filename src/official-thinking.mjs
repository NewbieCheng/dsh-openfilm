/**
 * Thinking intensity (DSH's `reasoningEffort`) as an OpenFilm chat option.
 *
 * Two things the panel needs that the model menu alone cannot give:
 *   1. an honest control — the efforts a model actually declares, plus "自动";
 *   2. a sensible default per turn — drafting is cheap, restructuring a whole
 *      film is not, and a person should not have to think about that.
 *
 * Everything here is pure: it maps a live DSH catalog (provider groups →
 * models → `reasoning.{efforts,defaultEffort}`) to the official ACP select
 * option shape, and picks an effort for a turn from the person's words. Nothing
 * calls DSH and nothing is cached, so a model switch is reflected immediately.
 */
export const AUTO = 'auto';
const MAX_EFFORTS = 8;
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 200 && !value.includes('\0');

/** Words that mean "look at the whole film again" rather than "touch this clip". */
const WHOLE_FILM = /(整片|整部|全片|重排|重新剪|重新做|从头|重来|重构|改结构|换风格|remix|restructure|re-?edit the (?:whole|entire))/i;
/** Words that mean the person is still deciding what the film should be. */
const DRAFTING = /(新建|草稿|大纲|脚本|思路|先试试|打个样|storyboard|draft|outline)/i;

/** The catalog entry for one selection, or undefined when it is gone. */
export function modelEntry(catalog, selection) {
  if (!catalog || !Array.isArray(catalog.groups) || !selection) return undefined;
  const { provider, model } = selection;
  if (!text(provider) || !text(model)) return undefined;
  for (const group of catalog.groups) {
    if (group?.id !== provider || !Array.isArray(group.models)) continue;
    return group.models.find(item => item?.id === model);
  }
  return undefined;
}

/** The efforts a model declares, in the order the provider listed them. */
export function effortsOf(entry) {
  const efforts = entry?.reasoning?.efforts;
  if (!Array.isArray(efforts)) return [];
  const seen = new Set();
  const result = [];
  for (const effort of efforts.slice(0, MAX_EFFORTS)) {
    if (!text(effort?.id) || seen.has(effort.id)) continue;
    seen.add(effort.id);
    result.push({ id: effort.id, name: text(effort.name) ? effort.name : effort.id });
  }
  return result;
}

/**
 * The select option the panel shows. `current` is what the Host last applied
 * (or what DSH reports); an effort the model no longer declares is reported as
 * "自动" rather than as a value the menu cannot show.
 */
export function thinkingOption({ efforts = [], defaultEffort, current } = {}) {
  const options = [{ value: AUTO, name: '自动（按这一句话的内容）' }];
  for (const effort of efforts) options.push({ value: effort.id, name: effort.name });
  const declared = efforts.some(effort => effort.id === current);
  return {
    id: 'thinking',
    name: '思考强度',
    category: 'thinking',
    type: 'select',
    ...(declared ? { currentValue: current } : { currentValue: AUTO }),
    options,
    ...(defaultEffort === undefined ? {} : { defaultEffort }),
  };
}

/** Lowest / middle / highest of the declared efforts, as ids. */
function rank(efforts) {
  if (efforts.length === 0) return {};
  return {
    low: efforts[0].id,
    high: efforts[efforts.length - 1].id,
    middle: efforts.length > 1 ? efforts[1].id : efforts[0].id,
  };
}

/**
 * Choose the effort for one turn.
 *
 * Rules, in order: an explicit choice wins; a whole-film request gets the
 * highest declared effort; a drafting request gets the lowest; otherwise the
 * provider's own default, else the middle rung. Undefined means "do not touch
 * the model's own default" — a model with no reasoning support has no rungs.
 */
export function chooseEffort({ efforts = [], defaultEffort, stored, prompt, firstTurn = false } = {}) {
  if (efforts.length === 0) return undefined;
  if (stored !== undefined && stored !== AUTO && efforts.some(effort => effort.id === stored)) return stored;
  const rungs = rank(efforts);
  const said = typeof prompt === 'string' ? prompt.slice(0, 4000) : '';
  if (WHOLE_FILM.test(said)) return rungs.high;
  if (DRAFTING.test(said)) return rungs.low;
  if (firstTurn) return rungs.low;
  if (text(defaultEffort) && efforts.some(effort => effort.id === defaultEffort)) return defaultEffort;
  return rungs.middle;
}
