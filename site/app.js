/* global lottie */
// Demo site: plays every example's CSS original (iframe) and its Lottie (lottie-web) in sync,
// and previews Lottie files dropped by the visitor. Nothing is uploaded anywhere.
(function () {
  "use strict";

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function setupDemo(el) {
    const d = el.dataset;
    const fps = Number(d.fps);
    const op = Number(d.op);
    const start = Number(d.start);
    const [w, h, vw, vh] = [d.w, d.h, d.vw, d.vh].map(Number);
    const iframe = el.querySelector("iframe");
    const cssFrame = el.querySelector(".css-frame");
    const lottieFrame = el.querySelector(".lottie-frame");
    const playBtn = el.querySelector(".play");
    const scrub = el.querySelector(".scrub");
    const label = el.querySelector(".frame-no");
    let playing = false;
    let resumeOnShow = false;
    let ready = 0;

    function fit() {
      const avail = cssFrame.parentElement.clientWidth * 0.92;
      const cs = Math.min(1.5, avail / Math.max(vw, vh));
      cssFrame.style.width = vw * cs + "px";
      cssFrame.style.height = vh * cs + "px";
      iframe.style.transform = "scale(" + cs + ")";
      const ls = Math.min(1.5, avail / Math.max(w, h));
      lottieFrame.style.width = w * ls + "px";
      lottieFrame.style.height = h * ls + "px";
    }
    fit();
    if ("ResizeObserver" in window) new ResizeObserver(fit).observe(cssFrame.parentElement);

    const anim = lottie.loadAnimation({
      container: lottieFrame,
      renderer: "svg",
      loop: true,
      autoplay: false,
      path: "examples/out/" + d.name + ".json",
    });

    function cssAnims() {
      try {
        return iframe.contentDocument.getAnimations();
      } catch {
        return [];
      }
    }
    // Composition frame -> source timeline time, as in the CLI's --preview page.
    function seekCss(frame, play) {
      const t = start + (frame * 1000) / fps;
      // Pause before seeking: a pending pause() would otherwise run one more frame.
      cssAnims().forEach((a) => {
        if (!play) a.pause();
        a.currentTime = t * a.playbackRate;
        if (play) a.play();
      });
    }
    function showFrame(f) {
      scrub.value = f;
      label.textContent = f + " / " + op;
    }
    function setPlaying(p) {
      playing = p;
      playBtn.textContent = p ? "Pause" : "Play";
      if (p) {
        seekCss(anim.currentFrame, true);
        anim.play();
      } else {
        // Stop both sides on the same whole frame.
        const f = Math.round(anim.currentFrame);
        anim.goToAndStop(f, true);
        seekCss(f, false);
        showFrame(f);
      }
    }
    function onReady() {
      if (++ready < 2) return;
      seekCss(0, false);
      anim.goToAndStop(0, true);
      showFrame(0);
      if (!reduceMotion) setPlaying(true);
    }

    anim.addEventListener("DOMLoaded", onReady);
    anim.addEventListener("loopComplete", () => {
      if (playing) seekCss(0, true);
    });
    anim.addEventListener("enterFrame", () => showFrame(Math.round(anim.currentFrame)));
    iframe.addEventListener("load", () => setTimeout(onReady, 50), { once: true });
    iframe.src = "examples/" + d.name + ".html";

    playBtn.addEventListener("click", () => setPlaying(!playing));
    scrub.addEventListener("input", () => {
      const f = Number(scrub.value);
      if (playing) setPlaying(false);
      anim.goToAndStop(f, true);
      seekCss(f, false);
      showFrame(f);
    });

    return {
      show() {
        if (resumeOnShow) setPlaying(true);
        resumeOnShow = false;
      },
      hide() {
        if (playing) {
          resumeOnShow = true;
          setPlaying(false);
        }
      },
    };
  }

  // Start each demo when it first scrolls into view; pause it while it is off screen.
  const demos = new Map();
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const demo = demos.get(e.target);
        if (e.isIntersecting) {
          if (!demo) demos.set(e.target, setupDemo(e.target));
          else demo.show();
        } else if (demo) {
          demo.hide();
        }
      }
    },
    { rootMargin: "200px 0px" },
  );
  document.querySelectorAll(".demo").forEach((el) => io.observe(el));

  // Lottie file viewer.
  const drop = document.getElementById("drop");
  const fileInput = document.getElementById("file");
  const out = document.getElementById("viewer-out");
  const stage = document.getElementById("viewer-stage");
  const vPlay = document.getElementById("viewer-play");
  const vScrub = document.getElementById("viewer-scrub");
  const vFrame = document.getElementById("viewer-frame");
  const vMeta = document.getElementById("viewer-meta");
  const vError = document.getElementById("viewer-error");
  let viewerAnim = null;

  function showError(msg) {
    vError.textContent = msg;
    vError.hidden = false;
  }
  async function loadFile(file) {
    vError.hidden = true;
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      return showError(file.name + " is not valid JSON.");
    }
    if (!data || !Array.isArray(data.layers) || !(data.w > 0) || !(data.h > 0)) {
      return showError(file.name + " doesn't look like a Lottie file (no layers or size).");
    }
    if (viewerAnim) viewerAnim.destroy();
    out.hidden = false;
    stage.style.aspectRatio = data.w + " / " + data.h;
    viewerAnim = lottie.loadAnimation({
      container: stage,
      renderer: "svg",
      loop: true,
      autoplay: !reduceMotion,
      animationData: data,
    });
    const total = Math.max(0, Math.round(viewerAnim.totalFrames));
    vScrub.max = total;
    vPlay.textContent = reduceMotion ? "Play" : "Pause";
    vFrame.textContent = "0 / " + total;
    viewerAnim.addEventListener("enterFrame", () => {
      const f = Math.round(viewerAnim.currentFrame);
      vScrub.value = f;
      vFrame.textContent = f + " / " + total;
    });
    vMeta.textContent =
      file.name +
      " · " +
      data.w +
      "×" +
      data.h +
      " · " +
      data.fr +
      " fps · " +
      total +
      " frames · " +
      data.layers.length +
      " layers · " +
      (file.size / 1024).toFixed(1) +
      " KB";
  }
  fileInput.addEventListener("change", () => {
    if (fileInput.files[0]) loadFile(fileInput.files[0]);
  });
  ["dragenter", "dragover"].forEach((t) =>
    drop.addEventListener(t, (e) => {
      e.preventDefault();
      drop.classList.add("over");
    }),
  );
  ["dragleave", "drop"].forEach((t) =>
    drop.addEventListener(t, () => drop.classList.remove("over")),
  );
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) loadFile(f);
  });
  // A file dropped outside the drop zone must not navigate away from the page.
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => e.preventDefault());
  vPlay.addEventListener("click", () => {
    if (!viewerAnim) return;
    if (viewerAnim.isPaused) viewerAnim.play();
    else viewerAnim.pause();
    vPlay.textContent = viewerAnim.isPaused ? "Play" : "Pause";
  });
  vScrub.addEventListener("input", () => {
    if (!viewerAnim) return;
    viewerAnim.goToAndStop(Number(vScrub.value), true);
    vPlay.textContent = "Play";
  });

  // Copy buttons.
  document.querySelectorAll("[data-copy]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const text = document.querySelector(btn.dataset.copy).textContent;
      try {
        await navigator.clipboard.writeText(text);
        btn.textContent = "Copied";
      } catch {
        btn.textContent = "Select & copy";
      }
      setTimeout(() => (btn.textContent = "Copy"), 1500);
    }),
  );
})();
