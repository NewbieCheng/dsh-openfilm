/**
 * Per-install OpenFilm preferences (not account-scoped).
 * Stored under `$DSH_HOME/no996-openfilm/preferences.json`.
 * No tokens, no secrets — only onboarding and default template hints.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const TEMPLATE_ID = /^(?:[a-z0-9][a-z0-9-]{1,40}|custom)$/;

const PRODUCT = Object.freeze({
  'paper-texture': {
    productTitle: '口播讲堂',
    productBlurb: '适合竖屏口播、课程讲解：一人出镜把一件事讲清楚。',
  },
  'replica-film': {
    productTitle: '知识大赏',
    productBlurb: '适合知识科普短片：分镜卡片串联，有场景与节奏感。',
  },
  sketchnote: {
    productTitle: '手绘笔记',
    productBlurb: '适合笔记风总结与轻教程：纸笔板书感，好读好记。',
  },
  'motion-styles': {
    productTitle: '动效风格样片',
    productBlurb: '适合强动效片头与品牌概念片：弹簧、错峰、镜头推拉更有冲击。',
  },
  custom: {
    productTitle: '自定义',
    productBlurb: '适合已有素材、先入库再定风格：空白开工，不预设片型。',
  },
});

function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh');
}

const RATIOS = new Set(['16:9', '9:16', '1:1']);
const SECONDS = new Set([15, 30, 60]);
const LANGUAGES = new Set(['中文', 'English']);

function finitePoints(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

function defaults() {
  return {
    onboardingCompleted: false,
    defaultTemplateId: '',
    lastProjectId: '',
    // 空白项目也记住画布与时长，下一次「自定义」不用重选。
    customRatio: '16:9',
    customSeconds: 30,
    customLanguage: '中文',
    // Workbench wallet snapshot (Host fills via account:balance). Not a secret.
    cachedAvailablePoints: null,
    cachedPointsBalance: null,
    cachedPeriodPointsBalance: null,
    cachedExpertPointsBalance: null,
    cachedPeriodExpiresAt: '',
    cachedBalanceAt: '',
  };
}

function sanitize(raw) {
  const base = defaults();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  return {
    onboardingCompleted: raw.onboardingCompleted === true,
    defaultTemplateId: typeof raw.defaultTemplateId === 'string' && TEMPLATE_ID.test(raw.defaultTemplateId)
      ? raw.defaultTemplateId
      : '',
    lastProjectId: typeof raw.lastProjectId === 'string' && /^[A-Za-z0-9_-]{6,40}$/.test(raw.lastProjectId)
      ? raw.lastProjectId
      : '',
    customRatio: RATIOS.has(raw.customRatio) ? raw.customRatio : '16:9',
    customSeconds: SECONDS.has(raw.customSeconds) ? raw.customSeconds : 30,
    customLanguage: LANGUAGES.has(raw.customLanguage) ? raw.customLanguage : '中文',
    cachedAvailablePoints: finitePoints(raw.cachedAvailablePoints),
    cachedPointsBalance: finitePoints(raw.cachedPointsBalance),
    cachedPeriodPointsBalance: finitePoints(raw.cachedPeriodPointsBalance),
    cachedExpertPointsBalance: finitePoints(raw.cachedExpertPointsBalance),
    cachedPeriodExpiresAt: typeof raw.cachedPeriodExpiresAt === 'string' ? raw.cachedPeriodExpiresAt.slice(0, 64) : '',
    cachedBalanceAt: typeof raw.cachedBalanceAt === 'string' ? raw.cachedBalanceAt.slice(0, 64) : '',
  };
}

/** Public wallet view derived from prefs cache (or a live workbench payload). */
export function balanceFromPrefs(prefs) {
  if (!prefs || typeof prefs !== 'object') {
    return {
      available_points: null,
      points_balance: null,
      period_points_balance: null,
      expert_points_balance: null,
      period_expires_at: null,
      cached_at: '',
    };
  }
  return {
    available_points: finitePoints(prefs.cachedAvailablePoints),
    points_balance: finitePoints(prefs.cachedPointsBalance),
    period_points_balance: finitePoints(prefs.cachedPeriodPointsBalance),
    expert_points_balance: finitePoints(prefs.cachedExpertPointsBalance),
    period_expires_at: prefs.cachedPeriodExpiresAt || null,
    cached_at: prefs.cachedBalanceAt || '',
  };
}

export function balanceCachePatch(live) {
  const permanent = finitePoints(live?.points_balance) ?? 0;
  const period = finitePoints(live?.period_points_balance) ?? 0;
  const expert = finitePoints(live?.expert_points_balance) ?? 0;
  const available = finitePoints(live?.available_points);
  return {
    cachedPointsBalance: permanent,
    cachedPeriodPointsBalance: period,
    cachedExpertPointsBalance: expert,
    cachedAvailablePoints: available == null ? permanent + period : available,
    cachedPeriodExpiresAt: typeof live?.period_expires_at === 'string' ? live.period_expires_at.slice(0, 64) : '',
    cachedBalanceAt: new Date().toISOString(),
  };
}

export function clearBalanceCachePatch() {
  return {
    cachedAvailablePoints: null,
    cachedPointsBalance: null,
    cachedPeriodPointsBalance: null,
    cachedExpertPointsBalance: null,
    cachedPeriodExpiresAt: '',
    cachedBalanceAt: '',
  };
}

export function productMeta(templateId) {
  return PRODUCT[templateId] || null;
}

export function onboardingCopy(templateId, presets = {}) {
  const meta = productMeta(templateId) || productMeta('custom');
  const name = meta.productTitle;
  if (templateId === 'custom') {
    return {
      title: 'AI 剪辑员工 · 下一步',
      steps: [
        '这是空白项目。',
        '先说主题和时长，或把素材拖进对话。',
        '想套口播/知识大赏/手绘骨架时再说一声。',
      ],
      ratio: presets?.ratio,
      seconds: presets?.seconds,
      language: presets?.language,
      uploadHint: '素材丢到对话框即可，我会放进项目素材库。不用去点左侧素材库按钮。',
    };
  }
  return {
    title: 'AI 剪辑员工 · 下一步',
    steps: [
      `已按「${name}」建好项目。`,
      '用一句话说主题和时长。',
      '把视频/音频/图片拖进对话，我来入库再帮你剪。',
    ],
    uploadHint: '素材丢到对话框即可，我会放进项目素材库。不用去点左侧素材库按钮。',
  };
}

export function createPreferencesStore({ home = dshHome() } = {}) {
  const file = join(home, 'no996-openfilm', 'preferences.json');
  let cache = null;
  let writeChain = Promise.resolve();

  async function read() {
    if (cache) return { ...cache };
    try {
      const raw = JSON.parse(await readFile(file, 'utf8'));
      cache = sanitize(raw);
    } catch {
      cache = defaults();
    }
    return { ...cache };
  }

  async function write(next) {
    const value = sanitize(next);
    cache = value;
    writeChain = writeChain.then(async () => {
      await mkdir(dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
      await rename(tmp, file);
    }).catch(() => {});
    await writeChain;
    return { ...value };
  }

  return {
    file,
    get: read,
    async set(patch) {
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        throw Object.assign(new Error('无效偏好'), { code: 'PREFS_INPUT', status: 400 });
      }
      const current = await read();
      const next = { ...current };
      if ('onboardingCompleted' in patch) next.onboardingCompleted = patch.onboardingCompleted === true;
      if ('defaultTemplateId' in patch) {
        const id = typeof patch.defaultTemplateId === 'string' ? patch.defaultTemplateId : '';
        if (id && !TEMPLATE_ID.test(id)) throw Object.assign(new Error('无效模板'), { code: 'PREFS_INPUT', status: 400 });
        next.defaultTemplateId = id;
      }
      if ('customRatio' in patch) {
        if (!RATIOS.has(patch.customRatio)) throw Object.assign(new Error('无效画布比例'), { code: 'PREFS_INPUT', status: 400 });
        next.customRatio = patch.customRatio;
      }
      if ('customLanguage' in patch) {
        if (!LANGUAGES.has(patch.customLanguage)) throw Object.assign(new Error('无效语言'), { code: 'PREFS_INPUT', status: 400 });
        next.customLanguage = patch.customLanguage;
      }
      if ('customSeconds' in patch) {
        const seconds = Number(patch.customSeconds);
        if (!SECONDS.has(seconds)) throw Object.assign(new Error('无效时长'), { code: 'PREFS_INPUT', status: 400 });
        next.customSeconds = seconds;
      }
      if ('lastProjectId' in patch) {
        const id = typeof patch.lastProjectId === 'string' ? patch.lastProjectId : '';
        if (id && !/^[A-Za-z0-9_-]{6,40}$/.test(id)) throw Object.assign(new Error('无效项目'), { code: 'PREFS_INPUT', status: 400 });
        next.lastProjectId = id;
      }
      for (const key of [
        'cachedAvailablePoints',
        'cachedPointsBalance',
        'cachedPeriodPointsBalance',
        'cachedExpertPointsBalance',
      ]) {
        if (key in patch) {
          if (patch[key] == null) next[key] = null;
          else {
            const n = finitePoints(patch[key]);
            if (n == null) throw Object.assign(new Error('无效积分缓存'), { code: 'PREFS_INPUT', status: 400 });
            next[key] = n;
          }
        }
      }
      if ('cachedPeriodExpiresAt' in patch) {
        next.cachedPeriodExpiresAt = typeof patch.cachedPeriodExpiresAt === 'string'
          ? patch.cachedPeriodExpiresAt.slice(0, 64)
          : '';
      }
      if ('cachedBalanceAt' in patch) {
        next.cachedBalanceAt = typeof patch.cachedBalanceAt === 'string'
          ? patch.cachedBalanceAt.slice(0, 64)
          : '';
      }
      return write(next);
    },
    productCatalog() {
      return Object.entries(PRODUCT).map(([id, meta]) => ({ id, ...meta }));
    },
  };
}
