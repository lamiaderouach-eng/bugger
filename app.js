(() => {
  'use strict';

  /* =====================================================
   * 1. SIMULADOR
   * ===================================================== */

  const CODE = [
    'public class Main {',
    '    static int doble(int x) {',
    '        int r = x * 2;',
    '        return r;',
    '    }',
    '',
    '    public static void main(String[] args) {',
    '        int n = 3;',
    '        int suma = 0;',
    '        for (int i = 0; i < n; i++) {',
    '            suma = suma + doble(i);',
    '        }',
    '        System.out.println(suma);',
    '    }',
    '}'
  ];

  /* Construye la "grabación" de la ejecución: una foto del estado en cada paso. */
  function buildTrace() {
    const T = [];
    const out = [];
    const stack = [{ name: 'main(String[] args)', line: 8, vars: {} }];
    const main = stack[0];

    const snap = (line, msg) => {
      stack[stack.length - 1].line = line;
      T.push({
        line,
        depth: stack.length,
        frames: JSON.parse(JSON.stringify(stack)).reverse(), // arriba del todo = frame actual
        out: out.slice(),
        msg
      });
    };

    snap(8, 'La JVM está parada en la primera línea de <code>main</code>. Esta línea <strong>todavía no se ha ejecutado</strong>.');
    main.vars.n = 3;
    snap(9, 'Se ejecutó la línea 8: ahora <code>n</code> vale 3.');
    main.vars.suma = 0;
    snap(10, 'Se creó <code>suma</code> con valor 0. Ahora empieza el bucle <code>for</code>.');
    main.vars.i = 0;

    let suma = 0;
    for (let i = 0; i < 3; i++) {
      main.vars.i = i;
      snap(10, i === 0
        ? 'El bucle crea <code>i = 0</code>. Comprueba <code>i &lt; n</code>: 0 &lt; 3 es verdadero, así que entra.'
        : `Sube <code>i</code> a ${i}. Comprueba <code>i &lt; n</code>: ${i} &lt; 3 es verdadero, así que entra otra vez.`);

      snap(11, `Esta línea llama a <code>doble(${i})</code>. Usa <strong>Step Into</strong> para entrar o <strong>Step Over</strong> para no entrar.`);

      stack.push({ name: 'doble(int x)', line: 3, vars: { x: i } });
      snap(3, `¡Dentro de <code>doble</code>! Mira la pila: <code>doble</code> está encima de <code>main</code>. Su <code>x</code> vale ${i}.`);

      const r = i * 2;
      stack[stack.length - 1].vars.r = r;
      snap(4, `Se calculó <code>r = x * 2</code> = ${r}. Ahora va a devolver ese valor.`);

      stack.pop();
      suma += i * 2;
      main.vars.suma = suma;
      if (i < 2) {
        main.vars.i = i + 1;
        snap(10, `La función terminó y salió de la pila. <code>suma</code> ahora vale ${suma}.`);
      }
    }
    snap(13, `El bucle terminó (<code>i</code> llegó a 3). <code>suma</code> vale ${suma}. Falta imprimirla.`);
    out.push(String(suma));
    snap(14, 'Se imprimió el resultado en la consola. Queda cerrar <code>main</code>.');

    /* paso final: el programa acabó */
    T.push({
      line: 0, depth: 0, frames: [], out: out.slice(), end: true,
      msg: '¡El programa terminó! La JVM ya no está parada. Pulsa <strong>Reiniciar</strong> para verlo otra vez.'
    });
    return T;
  }

  const TRACE = buildTrace();
  const LAST = TRACE.length - 1;

  /* ---- Estado ---- */
  let idx = -1;                 // -1 = aún sin iniciar
  const bps = new Set([11]);    // breakpoints (números de línea)
  let autoTimer = null;

  /* ---- Elementos ---- */
  const $ = (id) => document.getElementById(id);
  const el = {
    code: $('code'), explain: $('explain'), stack: $('stack'),
    vars: $('vars'), owner: $('vars-owner'), console: $('console'),
    resume: $('btn-resume'), into: $('btn-into'), over: $('btn-over'),
    out: $('btn-out'), auto: $('btn-auto'), reset: $('btn-reset')
  };

  /* ---- Resaltado de sintaxis sencillo ---- */
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const TOKEN = /(\/\/.*$)|("(?:[^"\\]|\\.)*")|\b(public|static|class|int|void|for|return|new|String)\b|\b(\d+)\b|\b([A-Za-z_]\w*)(?=\()/g;

  function highlight(text) {
    let html = '';
    let last = 0;
    let m;
    TOKEN.lastIndex = 0;
    while ((m = TOKEN.exec(text)) !== null) {
      html += esc(text.slice(last, m.index));
      const cls = m[1] ? 'com' : m[2] ? 'str' : m[3] ? 'kw' : m[4] ? 'num' : 'fn';
      html += `<span class="tok-${cls}">${esc(m[0])}</span>`;
      last = m.index + m[0].length;
    }
    return html + esc(text.slice(last));
  }

  /* ---- Pintar el código una sola vez ---- */
  const lineEls = [];
  CODE.forEach((text, i) => {
    const n = i + 1;
    const row = document.createElement('div');
    row.className = 'line';

    const bp = document.createElement('button');
    bp.className = 'bp';
    bp.type = 'button';
    bp.setAttribute('aria-label', `Breakpoint en la línea ${n}`);
    bp.setAttribute('aria-pressed', String(bps.has(n)));
    bp.addEventListener('click', () => {
      if (bps.has(n)) bps.delete(n); else bps.add(n);
      bp.setAttribute('aria-pressed', String(bps.has(n)));
    });

    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = n;

    const src = document.createElement('span');
    src.className = 'src';
    src.innerHTML = highlight(text) || '&nbsp;';

    row.append(bp, num, src);
    el.code.appendChild(row);
    lineEls[n] = row;
  });

  /* ---- Pintar el estado ---- */
  function render(prevIdx) {
    const step = idx >= 0 ? TRACE[idx] : null;
    const prev = prevIdx >= 0 ? TRACE[prevIdx] : null;

    // línea actual
    lineEls.forEach((row) => row && row.classList.remove('current', 'pulse'));
    if (step && step.line) {
      const row = lineEls[step.line];
      row.classList.add('current');
      void row.offsetWidth;            // reinicia la animación
      row.classList.add('pulse');
      row.scrollIntoView({ block: 'nearest' });
    }

    // explicación
    el.explain.innerHTML = step
      ? step.msg
      : 'El programa todavía no ha empezado. Hay un breakpoint rojo en la línea 11. Pulsa <strong>Debug</strong>: la JVM correrá hasta ahí y se parará.';

    // pila
    el.stack.innerHTML = '';
    if (!step || !step.frames.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = step ? '(vacía: el programa acabó)' : '(vacía: no hay programa en marcha)';
      el.stack.appendChild(li);
    } else {
      step.frames.forEach((f, k) => {
        const li = document.createElement('li');
        if (k === 0) li.className = 'top';
        // solo anima el frame nuevo
        if (prev && prev.frames.length >= step.frames.length) li.style.animation = 'none';
        li.innerHTML = `<span>${esc(f.name)}</span><span class="at">línea ${f.line}</span>`;
        el.stack.appendChild(li);
      });
    }

    // variables del frame de arriba
    el.vars.innerHTML = '';
    const top = step && step.frames[0];
    el.owner.textContent = top ? `(de ${top.name.split('(')[0]})` : '';
    const topVars = top ? Object.entries(top.vars) : [];
    if (!topVars.length) {
      const tr = document.createElement('tr');
      tr.className = 'empty';
      tr.innerHTML = '<td colspan="2">(ninguna todavía)</td>';
      el.vars.appendChild(tr);
    } else {
      const prevTop = prev && prev.frames[0] && prev.frames[0].name === top.name ? prev.frames[0].vars : {};
      topVars.forEach(([name, value]) => {
        const tr = document.createElement('tr');
        if (prevTop[name] !== value) tr.className = 'changed';
        tr.innerHTML = `<td>${esc(name)}</td><td class="val">${esc(String(value))}</td>`;
        el.vars.appendChild(tr);
      });
    }

    // consola
    el.console.textContent = step && step.out.length ? step.out.join('\n') : '';

    // botones
    const finished = !!(step && step.end);
    el.resume.disabled = finished;
    el.into.disabled = finished;
    el.over.disabled = finished;
    el.out.disabled = finished || !step || step.depth < 2;
    el.auto.disabled = finished;
    el.resume.firstChild.textContent = idx < 0 ? '▶ Debug ' : '▶ Continuar ';
    if (finished) stopAuto();
  }

  function goTo(j) {
    const old = idx;
    idx = Math.max(-1, Math.min(LAST, j));
    render(old);
  }

  /* ---- Acciones del depurador ---- */
  const cur = () => (idx >= 0 ? TRACE[idx] : { depth: 0, line: 0 });

  function stepInto() { if (idx < LAST) goTo(idx + 1); }

  function stepOver() {
    if (idx < 0) return goTo(0);
    const d = cur().depth;
    let j = idx + 1;
    while (j < LAST && TRACE[j].depth > d) j++;
    goTo(j);
  }

  function stepOut() {
    const d = cur().depth;
    if (d < 2) return;
    let j = idx + 1;
    while (j < LAST && TRACE[j].depth >= d) j++;
    goTo(j);
  }

  function resume() {
    let j = idx + 1;
    while (j < LAST && !bps.has(TRACE[j].line)) j++;
    goTo(j);
  }

  function reset() { stopAuto(); goTo(-1); }

  /* ---- Animar ---- */
  function stopAuto() {
    if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
    el.auto.setAttribute('aria-pressed', 'false');
    el.auto.textContent = '⏵ Animar';
  }

  function startAuto() {
    if (idx >= LAST) goTo(-1);
    el.auto.setAttribute('aria-pressed', 'true');
    el.auto.textContent = '⏸ Parar animación';
    autoTimer = setInterval(() => {
      if (idx >= LAST) return stopAuto();
      stepInto();
    }, 1600);
  }

  el.resume.addEventListener('click', () => { stopAuto(); resume(); });
  el.into.addEventListener('click', () => { stopAuto(); stepInto(); });
  el.over.addEventListener('click', () => { stopAuto(); stepOver(); });
  el.out.addEventListener('click', () => { stopAuto(); stepOut(); });
  el.reset.addEventListener('click', reset);
  el.auto.addEventListener('click', () => (autoTimer ? stopAuto() : startAuto()));

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest && e.target.closest('input, textarea, select')) return;
    const k = e.key.toLowerCase();
    const run = (btn, fn) => { if (!btn.disabled) { stopAuto(); fn(); } };
    if (k === 'r') run(el.resume, resume);
    else if (k === 'i') run(el.into, stepInto);
    else if (k === 'o') run(el.over, stepOver);
    else if (k === 'u') run(el.out, stepOut);
    else if (k === 'escape') reset();
  });

  render(-1);

  /* =====================================================
   * 2. IDE <-> JVM
   * ===================================================== */

  const MSGS = [
    { dir: 'go',   packet: 'SetBreakpoint',  code: 'SetBreakpoint(Main, línea 11)',   why: 'El IDE le dice a la JVM: “párate cuando llegues a la línea 11”.', jvm: 'run' },
    { dir: 'go',   packet: 'Resume',         code: 'Resume',                          why: 'El IDE dice: “empieza o sigue corriendo”.', jvm: 'run' },
    { dir: 'back', packet: 'Evento: parada', code: 'Event: BreakpointHit(línea 11)',  why: 'La JVM llega a la línea 11, <strong>congela el programa</strong> y avisa al IDE.', jvm: 'pause' },
    { dir: 'go',   packet: 'GetValues',      code: 'StackFrames + GetValues(i, suma)', why: 'El IDE pregunta: “¿quién me llamó y cuánto valen <code>i</code> y <code>suma</code>?”', jvm: 'pause' },
    { dir: 'back', packet: 'i=0, suma=0',    code: 'Reply: i = 0, suma = 0',          why: 'La JVM mira su memoria y responde. El IDE lo dibuja en el panel de variables.', jvm: 'pause' },
    { dir: 'go',   packet: 'Step',           code: 'Step(OVER)',                      why: 'Tú pulsas Step Over. El IDE pide: “ejecuta <strong>una</strong> línea y vuelve a parar”.', jvm: 'run' },
    { dir: 'back', packet: 'Evento: paso',   code: 'Event: SingleStep(línea 12)',     why: 'La JVM ejecutó la línea, se paró otra vez y lo comunica. Y vuelta a empezar.', jvm: 'pause' }
  ];

  const packet = $('packet');
  const wire = packet.parentElement;
  const jvmState = $('jvm-state');
  const jvmNode = document.querySelector('.node.jvm');
  const msgList = $('msgs');
  const archPlay = $('arch-play');
  const archNext = $('arch-next');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  MSGS.forEach((m) => {
    const li = document.createElement('li');
    li.innerHTML =
      `<span><span class="who ${m.dir}">${m.dir === 'go' ? 'IDE → JVM' : 'JVM → IDE'}</span>` +
      `<code>${esc(m.code)}</code><span class="why">${m.why}</span></span>`;
    msgList.appendChild(li);
  });

  let msgIdx = -1;
  let archTimer = null;
  let anim = null;

  function setJvm(state) {
    const paused = state === 'pause';
    jvmState.className = 'state ' + (paused ? 'paused' : 'running');
    jvmState.textContent = paused ? '■ Parada' : '● Corriendo';
    jvmNode.classList.toggle('is-paused', paused);
  }

  function showMsg(i) {
    msgIdx = i;
    const m = MSGS[i];
    [...msgList.children].forEach((li, k) => li.classList.toggle('active', k === i));

    packet.textContent = m.packet;
    packet.classList.toggle('back', m.dir === 'back');

    const dist = Math.max(0, wire.clientWidth - packet.offsetWidth);
    const from = m.dir === 'go' ? 0 : dist;
    const to = m.dir === 'go' ? dist : 0;

    if (anim) anim.cancel();
    if (reduceMotion || !packet.animate) {
      packet.style.opacity = 1;
      packet.style.left = to + 'px';
    } else {
      anim = packet.animate(
        [
          { left: from + 'px', opacity: 0 },
          { left: from + 'px', opacity: 1, offset: .1 },
          { left: to + 'px', opacity: 1, offset: .9 },
          { left: to + 'px', opacity: 1 }
        ],
        { duration: 1600, easing: 'ease-in-out', fill: 'forwards' }
      );
    }
    // El estado de la JVM cambia cuando el mensaje "llega"
    setTimeout(() => { if (msgIdx === i) setJvm(m.jvm); }, reduceMotion ? 0 : 1400);
  }

  function nextMsg() { showMsg((msgIdx + 1) % MSGS.length); }

  function setArchPlaying(on) {
    clearInterval(archTimer);
    archTimer = null;
    archPlay.setAttribute('aria-pressed', String(on));
    archPlay.textContent = on ? '⏸ Pausar' : '⏵ Reproducir';
    if (on) archTimer = setInterval(nextMsg, 3200);
  }

  archPlay.addEventListener('click', () => setArchPlaying(!archTimer));
  archNext.addEventListener('click', () => { nextMsg(); if (archTimer) setArchPlaying(true); });

  // Solo se anima cuando la sección está a la vista
  const archSection = $('por-dentro');
  let started = false;
  function startArch() {
    if (started) return;
    started = true;
    nextMsg();
    setArchPlaying(!reduceMotion);
  }
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries, obs) => {
      if (entries.some((e) => e.isIntersecting)) { startArch(); obs.disconnect(); }
    }, { threshold: 0.25 }).observe(archSection);
  } else {
    startArch();
  }
})();
