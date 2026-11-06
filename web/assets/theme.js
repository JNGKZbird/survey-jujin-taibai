/* 主题偏好：白 / 黑 / 跟随系统。
 * 在 <head> 里同步加载，先于样式表绘制设置 data-theme，避免启动闪白。
 * 偏好存在 localStorage（本机界面偏好，不属于项目数据）。 */
(function () {
  "use strict";

  var KEY = "survey-jujin.theme";
  var PREFERENCES = ["light", "dark", "system"];
  var DEFAULT_PREFERENCE = "light";
  var MEDIA = "(prefers-color-scheme: dark)";
  var REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
  var FALLBACK_FADE_OUT_MS = 130;
  var FALLBACK_FADE_IN_MS = 190;
  var hasWindow = typeof window !== "undefined";
  var hasDocument = typeof document !== "undefined";
  var listeners = [];

  function normalize(value) {
    return PREFERENCES.indexOf(value) === -1 ? DEFAULT_PREFERENCE : value;
  }

  function resolve(preference, systemDark) {
    var pref = normalize(preference);
    return pref === "system" ? (systemDark ? "dark" : "light") : pref;
  }

  function readStored() {
    if (!hasWindow) return DEFAULT_PREFERENCE;
    try {
      if (!window.localStorage) return DEFAULT_PREFERENCE;
      return normalize(window.localStorage.getItem(KEY));
    } catch (err) {
      return DEFAULT_PREFERENCE;
    }
  }

  function systemDark() {
    if (!hasWindow || !window.matchMedia) return false;
    try {
      return !!window.matchMedia(MEDIA).matches;
    } catch (err) {
      return false;
    }
  }

  var currentPreference = readStored();

  function effective(preference) {
    return resolve(preference == null ? currentPreference : preference, systemDark());
  }

  function apply() {
    if (!hasDocument || !document.documentElement) return;
    var root = document.documentElement;
    var theme = effective();
    root.setAttribute("data-theme", theme);
    root.setAttribute("data-theme-pref", currentPreference);
    root.style.colorScheme = theme;
  }

  function notify() {
    var theme = effective();
    listeners.slice().forEach(function (fn) {
      try {
        fn(currentPreference, theme);
      } catch (err) {
        /* 单个监听器出错不影响主题本身 */
      }
    });
  }

  function setPreference(value) {
    var next = normalize(value);
    var changed = next !== currentPreference;
    currentPreference = next;
    if (hasWindow) {
      try {
        if (window.localStorage) window.localStorage.setItem(KEY, next);
      } catch (err) {
        /* 隐私模式或存储被禁用时只在本次会话生效 */
      }
    }
    apply();
    if (changed) notify();
    return next;
  }

  function prefersReducedMotion() {
    if (!hasWindow || !window.matchMedia) return false;
    try {
      return !!window.matchMedia(REDUCED_MOTION).matches;
    } catch (err) {
      return false;
    }
  }

  function canAnimate() {
    if (!hasDocument || !hasWindow || !document.body) return false;
    if (document.visibilityState === "hidden") return false;
    return !prefersReducedMotion();
  }

  /* 旧内核没有 View Transition 时的退路：整屏盖成舞台色，在看不见时换主题，再淡出。 */
  function fadeUpdate(run) {
    var overlay = document.createElement("div");
    overlay.className = "theme-fade";
    document.body.appendChild(overlay);
    void overlay.offsetWidth; /* 先让 opacity:0 落定，后面的 1 才会产生过渡 */
    overlay.style.transition = "opacity " + FALLBACK_FADE_OUT_MS + "ms ease-out";
    overlay.style.opacity = "1";
    window.setTimeout(function () {
      run();
      overlay.style.transition = "opacity " + FALLBACK_FADE_IN_MS + "ms ease-in";
      overlay.style.opacity = "0";
      window.setTimeout(function () {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }, FALLBACK_FADE_IN_MS + 50);
    }, FALLBACK_FADE_OUT_MS + 30);
  }

  function animateUpdate(run) {
    if (!canAnimate()) {
      run();
      return;
    }
    if (typeof document.startViewTransition === "function") {
      try {
        document.startViewTransition(run);
        return;
      } catch (err) {
        /* 当前状态无法截图时，退回覆盖层淡入淡出 */
      }
    }
    fadeUpdate(run);
  }

  /* 抽屉里点选主题时用：颜色真的会变才做过渡；同一主题或系统恰好同色时直接落定。 */
  function setPreferenceAnimated(value, after) {
    var next = normalize(value);
    var run = function () {
      setPreference(next);
      if (typeof after === "function") after();
    };
    if (!hasDocument || next === currentPreference) {
      run();
      return next;
    }
    if (resolve(next, systemDark()) === effective()) {
      run();
      return next;
    }
    animateUpdate(run);
    return next;
  }

  function onChange(fn) {
    if (typeof fn !== "function") return function () {};
    listeners.push(fn);
    return function () {
      var index = listeners.indexOf(fn);
      if (index !== -1) listeners.splice(index, 1);
    };
  }

  function watchSystem() {
    if (!hasWindow || !window.matchMedia) return;
    var media;
    try {
      media = window.matchMedia(MEDIA);
    } catch (err) {
      return;
    }
    function handle() {
      if (currentPreference !== "system") return;
      if (!hasDocument || !document.documentElement) return;
      var nextTheme = resolve(currentPreference, systemDark());
      if (document.documentElement.getAttribute("data-theme") === nextTheme) return;
      animateUpdate(function () {
        apply();
        notify();
      });
    }
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", handle);
    } else if (typeof media.addListener === "function") {
      media.addListener(handle);
    }
  }

  var api = {
    KEY: KEY,
    PREFERENCES: Object.freeze(PREFERENCES.slice()),
    DEFAULT_PREFERENCE: DEFAULT_PREFERENCE,
    normalize: normalize,
    resolve: resolve,
    effective: effective,
    apply: apply,
    getPreference: function () { return currentPreference; },
    getTheme: function () { return effective(); },
    isDark: function () { return effective() === "dark"; },
    setPreference: setPreference,
    setPreferenceAnimated: setPreferenceAnimated,
    onChange: onChange
  };

  if (hasDocument) {
    apply();
    watchSystem();
  }
  if (hasWindow) window.JujinTheme = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
