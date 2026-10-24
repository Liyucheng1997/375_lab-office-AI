// 动画与切换效果定义（Web Animations API 关键帧）。

export const ANIMS = {
  entrance: [
    { id: 'appear', name: '出现' },
    { id: 'fade', name: '淡入' },
    { id: 'flyBottom', name: '飞入(自底)' },
    { id: 'flyLeft', name: '飞入(自左)' },
    { id: 'flyRight', name: '飞入(自右)' },
    { id: 'flyTop', name: '飞入(自顶)' },
    { id: 'floatUp', name: '上浮' },
    { id: 'zoomIn', name: '缩放' },
    { id: 'bounceIn', name: '弹跳' },
    { id: 'spinIn', name: '旋转' },
    { id: 'wipeIn', name: '擦除' },
    { id: 'splitIn', name: '劈裂' },
    { id: 'expand', name: '展开' },
  ],
  emphasis: [
    { id: 'pulse', name: '脉冲' },
    { id: 'spin', name: '陀螺旋' },
    { id: 'blink', name: '闪烁' },
    { id: 'shake', name: '跷跷板' },
    { id: 'grow', name: '放大/缩小' },
    { id: 'wave', name: '波浪' },
  ],
  exit: [
    { id: 'disappear', name: '消失' },
    { id: 'fadeOut', name: '淡出' },
    { id: 'flyOutBottom', name: '飞出(到底)' },
    { id: 'flyOutRight', name: '飞出(到右)' },
    { id: 'zoomOut', name: '缩小' },
    { id: 'wipeOut', name: '擦除' },
    { id: 'spinOut', name: '旋转消失' },
  ],
};

export const CAT_NAMES = { entrance: '进入', emphasis: '强调', exit: '退出' };
export const CAT_COLORS = { entrance: '#34c759', emphasis: '#ff9500', exit: '#ff3b30' };
export const TRIGGERS = [
  { value: 'click', label: '单击时' },
  { value: 'with', label: '与上一动画同时' },
  { value: 'after', label: '上一动画之后' },
];

export function animName(id) {
  for (const cat of Object.keys(ANIMS)) {
    const a = ANIMS[cat].find((x) => x.id === id);
    if (a) return a.name;
  }
  return id;
}
export function animCat(id) {
  for (const cat of Object.keys(ANIMS)) if (ANIMS[cat].some((x) => x.id === id)) return cat;
  return 'entrance';
}

/** 返回 [keyframes, options 补充]；rot 为元素原始旋转角 */
export function animKeyframes(effect, rot = 0) {
  const R = (extra = '') => `rotate(${rot}deg) ${extra}`;
  switch (effect) {
    case 'appear': return [[{ opacity: 0 }, { opacity: 1 }], { duration: 1 }];
    case 'fade': return [[{ opacity: 0 }, { opacity: 1 }]];
    case 'flyBottom': return [[{ transform: `translateY(120vh) ${R()}` }, { transform: R() }], { easing: 'cubic-bezier(.2,.8,.3,1)' }];
    case 'flyTop': return [[{ transform: `translateY(-120vh) ${R()}` }, { transform: R() }], { easing: 'cubic-bezier(.2,.8,.3,1)' }];
    case 'flyLeft': return [[{ transform: `translateX(-120vw) ${R()}` }, { transform: R() }], { easing: 'cubic-bezier(.2,.8,.3,1)' }];
    case 'flyRight': return [[{ transform: `translateX(120vw) ${R()}` }, { transform: R() }], { easing: 'cubic-bezier(.2,.8,.3,1)' }];
    case 'floatUp': return [[{ opacity: 0, transform: `translateY(60px) ${R()}` }, { opacity: 1, transform: R() }], { easing: 'ease-out' }];
    case 'zoomIn': return [[{ opacity: 0, transform: `${R()} scale(.2)` }, { opacity: 1, transform: `${R()} scale(1)` }], { easing: 'ease-out' }];
    case 'bounceIn': return [[
      { opacity: 0, transform: `${R()} scale(.3)` }, { opacity: 1, transform: `${R()} scale(1.08)`, offset: 0.55 },
      { transform: `${R()} scale(.94)`, offset: 0.75 }, { transform: `${R()} scale(1)` }]];
    case 'spinIn': return [[{ opacity: 0, transform: `rotate(${rot - 360}deg) scale(.3)` }, { opacity: 1, transform: `rotate(${rot}deg) scale(1)` }], { easing: 'ease-out' }];
    case 'wipeIn': return [[{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }]];
    case 'splitIn': return [[{ clipPath: 'inset(0 50% 0 50%)' }, { clipPath: 'inset(0 0 0 0)' }]];
    case 'expand': return [[{ opacity: 0, transform: `${R()} scaleX(.1)` }, { opacity: 1, transform: `${R()} scaleX(1)` }]];
    case 'pulse': return [[{ transform: `${R()} scale(1)` }, { transform: `${R()} scale(1.12)` }, { transform: `${R()} scale(1)` }]];
    case 'spin': return [[{ transform: `rotate(${rot}deg)` }, { transform: `rotate(${rot + 360}deg)` }], { easing: 'ease-in-out' }];
    case 'blink': return [[{ opacity: 1 }, { opacity: 0.1 }, { opacity: 1 }, { opacity: 0.1 }, { opacity: 1 }]];
    case 'shake': return [[{ transform: R() }, { transform: `rotate(${rot - 8}deg)` }, { transform: `rotate(${rot + 8}deg)` }, { transform: `rotate(${rot - 5}deg)` }, { transform: `rotate(${rot + 5}deg)` }, { transform: R() }]];
    case 'grow': return [[{ transform: `${R()} scale(1)` }, { transform: `${R()} scale(1.3)`, offset: 0.5 }, { transform: `${R()} scale(1)` }]];
    case 'wave': return [[{ transform: R() }, { transform: `translateY(-14px) ${R()}` }, { transform: `translateY(8px) ${R()}` }, { transform: R() }]];
    case 'disappear': return [[{ opacity: 1 }, { opacity: 0 }], { duration: 1 }];
    case 'fadeOut': return [[{ opacity: 1 }, { opacity: 0 }]];
    case 'flyOutBottom': return [[{ transform: R() }, { transform: `translateY(120vh) ${R()}` }], { easing: 'cubic-bezier(.6,0,.8,.3)' }];
    case 'flyOutRight': return [[{ transform: R() }, { transform: `translateX(120vw) ${R()}` }], { easing: 'cubic-bezier(.6,0,.8,.3)' }];
    case 'zoomOut': return [[{ opacity: 1, transform: `${R()} scale(1)` }, { opacity: 0, transform: `${R()} scale(.2)` }]];
    case 'wipeOut': return [[{ clipPath: 'inset(0 0 0 0)' }, { clipPath: 'inset(0 0 0 100%)' }]];
    case 'spinOut': return [[{ opacity: 1, transform: `rotate(${rot}deg) scale(1)` }, { opacity: 0, transform: `rotate(${rot + 360}deg) scale(.2)` }]];
    default: return [[{ opacity: 0 }, { opacity: 1 }]];
  }
}

/**
 * 把动画列表分成"单击步骤"。返回 { auto: [...], steps: [[...], ...] }
 * 每项 { anim, start(ms) }。auto 为进入幻灯片后自动播放的项（首个动画非"单击"时）。
 */
export function buildSteps(animations) {
  const steps = [];
  let cur = null, prevStart = 0, prevEnd = 0;
  for (const a of animations || []) {
    const dur = (a.duration ?? 0.5) * 1000, delay = (a.delay || 0) * 1000;
    let start;
    if (!cur || a.trigger === 'click') {
      cur = { auto: !steps.length && a.trigger !== 'click', items: [] };
      steps.push(cur);
      start = delay;
    } else if (a.trigger === 'with') start = prevStart + delay;
    else start = prevEnd + delay;
    cur.items.push({ anim: a, start });
    prevStart = start;
    prevEnd = start + dur;
  }
  const auto = steps.length && steps[0].auto ? steps.shift().items : [];
  return { auto, steps: steps.map((s) => s.items) };
}

export const TRANSITIONS = [
  { id: 'none', name: '无' },
  { id: 'fade', name: '淡出' },
  { id: 'push', name: '推入' },
  { id: 'wipe', name: '擦除' },
  { id: 'split', name: '分割' },
  { id: 'cover', name: '覆盖' },
  { id: 'uncover', name: '揭开' },
  { id: 'zoom', name: '缩放' },
  { id: 'flip', name: '翻转' },
  { id: 'cube', name: '立方体' },
  { id: 'circle', name: '圆形' },
  { id: 'blinds', name: '百叶窗' },
  { id: 'random', name: '随机' },
];

/** 播放切换：oldEl / newEl 为叠放在同一容器中的两层，返回 Promise */
export function playTransition(type, oldEl, newEl, duration = 0.7) {
  if (type === 'random') {
    const pool = TRANSITIONS.filter((t) => !['none', 'random'].includes(t.id));
    type = pool[Math.floor(Math.random() * pool.length)].id;
  }
  const ms = Math.max(100, duration * 1000);
  const opt = { duration: ms, easing: 'ease-in-out', fill: 'both' };
  const anims = [];
  const A = (el, kf, o = {}) => el && anims.push(el.animate(kf, { ...opt, ...o }));
  switch (type) {
    case 'none':
      return Promise.resolve();
    case 'fade':
      A(newEl, [{ opacity: 0 }, { opacity: 1 }]);
      break;
    case 'push':
      A(oldEl, [{ transform: 'translateX(0)' }, { transform: 'translateX(-100%)' }]);
      A(newEl, [{ transform: 'translateX(100%)' }, { transform: 'translateX(0)' }]);
      break;
    case 'wipe':
      A(newEl, [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }]);
      break;
    case 'split':
      A(newEl, [{ clipPath: 'inset(0 50% 0 50%)' }, { clipPath: 'inset(0 0 0 0)' }]);
      break;
    case 'cover':
      A(newEl, [{ transform: 'translateX(100%)' }, { transform: 'translateX(0)' }]);
      break;
    case 'uncover':
      if (oldEl) { oldEl.style.zIndex = 2; A(oldEl, [{ transform: 'translateX(0)' }, { transform: 'translateX(-100%)' }]); }
      break;
    case 'zoom':
      A(newEl, [{ opacity: 0, transform: 'scale(.3)' }, { opacity: 1, transform: 'scale(1)' }]);
      A(oldEl, [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(1.4)' }]);
      break;
    case 'flip':
      A(oldEl, [{ transform: 'perspective(1600px) rotateY(0)' }, { transform: 'perspective(1600px) rotateY(90deg)' }], { duration: ms / 2, easing: 'ease-in' });
      A(newEl, [{ transform: 'perspective(1600px) rotateY(-90deg)' }, { transform: 'perspective(1600px) rotateY(0)' }], { duration: ms / 2, delay: ms / 2, easing: 'ease-out' });
      break;
    case 'cube':
      A(oldEl, [{ transform: 'perspective(2000px) rotateY(0) translateX(0)', transformOrigin: '100% 50%' }, { transform: 'perspective(2000px) rotateY(-90deg)', transformOrigin: '100% 50%' }]);
      A(newEl, [{ transform: 'perspective(2000px) rotateY(90deg)', transformOrigin: '0% 50%' }, { transform: 'perspective(2000px) rotateY(0)', transformOrigin: '0% 50%' }]);
      if (oldEl) A(oldEl, [{ transform: 'translateX(0)' }, { transform: 'translateX(-100%)' }], { composite: 'add' });
      if (newEl) A(newEl, [{ transform: 'translateX(100%)' }, { transform: 'translateX(0)' }], { composite: 'add' });
      break;
    case 'circle':
      A(newEl, [{ clipPath: 'circle(0% at 50% 50%)' }, { clipPath: 'circle(75% at 50% 50%)' }]);
      break;
    case 'blinds': {
      const n = 8, parts = [];
      for (let i = 0; i < n; i++) parts.push(i);
      const poly = (p) => 'polygon(' + parts.map((i) => {
        const y0 = (i * 100) / n, y1 = y0 + (p * 100) / n;
        return `0% ${y0}%, 100% ${y0}%, 100% ${y1}%, 0% ${y1}%, 0% ${y0}%`;
      }).join(', ') + ')';
      A(newEl, [{ clipPath: poly(0.001) }, { clipPath: poly(1) }]);
      break;
    }
    default:
      A(newEl, [{ opacity: 0 }, { opacity: 1 }]);
  }
  const done = Promise.all(anims.map((a) => a.finished.catch(() => {})));
  // 页面不可见时动画时间线可能暂停，超时后强制结束
  const guard = new Promise((r) => setTimeout(() => { anims.forEach((a) => { try { a.finish(); } catch {} }); r(); }, ms * 1.5 + 400));
  return Promise.race([done, guard]).then(() => anims);
}
