(() => {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const BOARD_SIZE = 50; // bảng vàng chỉ công khai Top 50; từ hạng 51 phải tra đúng tên mới thấy
  let DATA, people, winners, bySlug;
  let raceToken = 0;

  // ---------- Tiện ích ----------
  const norm = (s) =>
    (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/đ/g, "d").replace(/Đ/g, "d").toLowerCase().replace(/\s+/g, " ").trim();

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const rand = (a, b) => a + Math.random() * (b - a);

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function slugFromInput(q) {
    const m = q.match(/profile\.php\?id=(\d+)/) || q.match(/facebook\.com\/([^/?#\s]+)/i);
    return m ? m[1].toLowerCase() : null;
  }

  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove("show"), 2200);
  }

  function shareUrl(p) {
    return `${location.origin}${location.pathname}?u=${encodeURIComponent(p.slug)}`;
  }

  // ---------- Dữ liệu ----------
  async function load() {
    const res = await fetch("data.json", { cache: "no-cache" });
    DATA = await res.json();
    people = DATA.people.map(([name, slug, rank, answer]) => ({ name, slug, rank, answer, key: norm(name) }));
    bySlug = new Map(people.map((p) => [p.slug, p]));
    winners = people.filter((p) => p.rank && p.rank <= DATA.winners).sort((a, b) => a.rank - b.rank);
  }

  function renderStats() {
    const correct = people.filter((p) => p.rank).length;
    $("#stats").innerHTML = [
      ["👥", people.length, "người chơi"],
      ["✅", correct, "trả lời đúng"],
      ["🏆", winners.length, "trúng thưởng"],
    ].map(([i, n, l]) => `<span class="stat">${i} <b>${n}</b> ${l}</span>`).join("");
  }

  // ---------- Tìm kiếm ----------
  function search(q) {
    q = q.trim();
    if (!q) return [];
    const slug = slugFromInput(q);
    if (slug) return bySlug.has(slug) ? [bySlug.get(slug)] : [];
    const k = norm(q);
    const exact = people.filter((p) => p.key === k);
    if (exact.length) return exact;
    // Tìm gần đúng: chấm điểm từng người, lấy tối đa 10 gợi ý (chỉ hiện tên, không lộ hạng)
    return people
      .map((p) => ({ p, s: score(k, p.key) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 10)
      .map((x) => x.p);
  }

  function lev(a, b) {
    const row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      let prev = row[0];
      row[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const tmp = row[j];
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = tmp;
      }
    }
    return row[b.length];
  }

  // Một từ gõ vào khớp một từ trong tên: trùng, là đầu của từ, hoặc sai tối đa 1 chữ (từ ≥ 4 chữ)
  function wordHit(w, words) {
    if (words.includes(w)) return 3;
    if (words.some((x) => x.startsWith(w))) return 2;
    if (w.length >= 4 && words.some((x) => Math.abs(x.length - w.length) <= 1 && lev(w, x) <= 1)) return 1;
    return 0;
  }

  function score(k, key) {
    const qs = k.split(" ");
    const words = key.split(" ");
    if (key.includes(k)) {
      const whole = qs.every((w) => words.includes(w)) ? 20 : 0; // trùng nguyên từ được ưu tiên
      return 100 + whole - (key.length - k.length) * 0.1;
    }
    const hits = qs.map((w) => wordHit(w, words));
    if (hits.every((h) => h)) return 50 + hits.reduce((a, b) => a + b, 0);       // đủ mọi từ, không cần đúng thứ tự
    if (k.length >= 5 && lev(k, key) <= Math.max(1, Math.floor(k.length / 5))) return 40; // gõ sai vài chữ
    return 0;
  }

  function showMatches(list, q) {
    const ul = $("#matches");
    if (!list.length) {
      ul.innerHTML = `<li class="empty">Không tìm thấy “${esc(q)}”. Thử nhập tên Facebook của bạn (không cần dấu) hoặc dán link trang cá nhân nhé.</li>`;
      return;
    }
    if (list.length === 1 && list[0].key === norm(q)) { ul.innerHTML = ""; $("#q").value = ""; runRace(list[0]); return; }
    ul.innerHTML = `<li class="empty">Có phải bạn là…?</li>` + list.map((p) =>
      `<li><button type="button" data-slug="${esc(p.slug)}">${esc(p.name)} <small>fb.com/${esc(p.slug)}</small></button></li>`
    ).join("");
  }

  // ---------- Hiệu ứng: tên bay & rơi dần ----------
  // Thứ tự bị loại: người trả lời sai (ngẫu nhiên) → người đúng từ hạng thấp nhất lên tới hạng 101.
  function dropOrder(me) {
    const wrong = shuffle(people.filter((p) => !p.rank && p !== me));
    if (!me.rank) wrong.push(me); // người tra trả lời sai: rơi cuối nhóm sai cho hồi hộp
    const late = people.filter((p) => p.rank > DATA.winners).sort((a, b) => b.rank - a.rank);
    return wrong.concat(late);
  }

  // Nhịp rơi: chậm lúc đầu, nhanh ở giữa, chậm dần khi sắp tới tên người tra
  function delays(n) {
    if (!n) return [];
    const w = Array.from({ length: n }, (_, i) =>
      1 + 4 * Math.exp(-i / 4) + 14 * Math.exp(-(n - 1 - i) / 5));
    const total = Math.min(10000, 2500 + n * 28);
    const sum = w.reduce((a, b) => a + b, 0);
    return w.map((x) => (x / sum) * total);
  }

  function buildStage(me) {
    const stage = $("#stage");
    stage.classList.remove("done");
    stage.querySelectorAll(".nm").forEach((n) => n.remove());
    const frag = document.createDocumentFragment();
    const els = new Map();
    for (const p of people) {
      const d = document.createElement("div");
      d.className = "nm" + (p === me ? " me" : "");
      d.style.left = `${rand(-2, 82)}%`;
      d.style.top = `${rand(9, 90)}%`;
      d.style.setProperty("--dx", `${rand(8, 26).toFixed(1)}px`);
      d.style.setProperty("--dy", `${rand(6, 18).toFixed(1)}px`);
      d.style.setProperty("--d", `${rand(1.6, 3.2).toFixed(2)}s`);
      d.style.setProperty("--delay", `${rand(-3, 0).toFixed(2)}s`);
      d.style.setProperty("--rot", `${rand(-200, 200).toFixed(0)}deg`);
      d.innerHTML = `<span>${esc(p.name)}</span>`;
      frag.appendChild(d);
      els.set(p, d);
    }
    stage.appendChild(frag);
    return els;
  }

  function setCounter(left, note) {
    $("#counter").innerHTML = `Còn bay: <b>${left}</b> / ${people.length}${note ? ` · ${note}` : ""}`;
  }

  function drop(el) {
    el.classList.add("out");
    setTimeout(() => el.remove(), 2000);
  }

  async function runRace(p) {
    const token = ++raceToken;
    const alive = () => token === raceToken;

    $("#boardCard").classList.add("hidden");
    $("#result").innerHTML = "";
    $("#result").className = "result";
    const card = $("#raceCard");
    card.classList.remove("hidden");
    card.scrollIntoView({ behavior: "smooth", block: "start" });

    const els = buildStage(p);
    const order = dropOrder(p);
    const stopAt = order.indexOf(p);               // -1 nghĩa là người tra lọt Top 100
    const before = stopAt === -1 ? order : order.slice(0, stopAt);
    let left = people.length;
    setCounter(left, "Top 100 sẽ còn ở lại");

    await sleep(1400);                             // cho mọi người ngắm cả đàn tên bay
    for (const [i, ms] of delays(before.length).entries()) {
      if (!alive()) return;
      drop(els.get(before[i]));
      setCounter(--left, left <= 120 ? "sắp xong…" : "");
      await sleep(ms);
    }
    if (!alive()) return;

    const meEl = els.get(p);
    if (stopAt === -1) {
      // Lọt Top 100: phần còn lại sáng vàng, tên người tra phóng to
      $("#stage").classList.add("done");
      els.forEach((el) => el.classList.add("safe"));
      meEl.classList.add("win");
      setCounter(left, "🏆 Top 100");
      confetti(p.rank <= 3 ? 320 : 220);
    } else {
      setCounter(left, "ơ kìa…");
      meEl.classList.add("shake");
      await sleep(1100);
      if (!alive()) return;
      meEl.classList.remove("shake");
      drop(meEl);
      setCounter(--left, "");
      await sleep(1500);
      if (!alive()) return;
      $("#stage").classList.add("done");
    }
    showResult(p);
    await sleep(900);
    if (alive()) showBoard();
  }

  function showResult(p) {
    const r = $("#result");
    const share = `
      <div class="actions">
        <button type="button" class="ghost" data-act="copy">📋 Copy link kết quả</button>
        <button type="button" class="ghost" data-act="again">🔍 Tra người khác</button>
      </div>`;

    if (p.rank && p.rank <= DATA.winners) {
      r.className = "result win";
      r.innerHTML = `
        <div class="trophy">🏆</div>
        <div class="name">${esc(p.name)}</div>
        <div class="big">CHÚC MỪNG! BẠN ĐÃ TRÚNG THƯỞNG</div>
        <div class="rank">#${p.rank}</div>
        <p>Tên bạn trụ vững tới cuối – hạng <b>${p.rank}</b> trong Top ${DATA.winners} trả lời đúng sớm nhất 🎉</p>
        ${share}`;
    } else if (p.rank) {
      r.className = "result lose";
      r.innerHTML = `
        <div class="name">${esc(p.name)}</div>
        <div class="big">Trả lời đúng rồi, nhưng hơi chậm chân 😢</div>
        <div class="rank">#${p.rank}</div>
        <p>Bạn chỉ cách Top ${DATA.winners} đúng <b>${p.rank - DATA.winners}</b> người. Hẹn bạn ở minigame sau nhé!</p>
        ${share}`;
    } else {
      r.className = "result lose";
      r.innerHTML = `
        <div class="trophy">💥</div>
        <div class="name">${esc(p.name)}</div>
        <div class="big">Tiếc quá, câu trả lời chưa đúng</div>
        <blockquote>${esc(p.answer || "—")}</blockquote>
        <p>Đáp án đúng: <b>01 – ${esc(DATA.answer[0])}</b> · <b>02 – ${esc(DATA.answer[1])}</b></p>
        ${share}`;
    }
    r.dataset.slug = p.slug;
  }

  // ---------- Bảng vàng (chỉ hiện sau hiệu ứng) ----------
  function showBoard() {
    const card = $("#boardCard");
    if (!card.classList.contains("hidden")) return;
    card.classList.remove("hidden");
    renderBoard($("#boardFilter").value);
    document.querySelectorAll(".step").forEach((s) => s.classList.remove("show"));
    document.querySelectorAll(".step").forEach((s, i) => setTimeout(() => s.classList.add("show"), [300, 0, 600][i]));
  }

  function renderPodium() {
    const [a, b, c] = winners;
    const step = (p, cls, n) => p ? `<div class="step ${cls}"><div class="who">${esc(p.name)}</div><div class="block">${n}</div></div>` : "<div></div>";
    $("#podium").innerHTML = step(b, "p2", 2) + step(a, "p1", 1) + step(c, "p3", 3);
  }

  function renderBoard(filter = "") {
    const k = norm(filter);
    const top = winners.slice(0, BOARD_SIZE);
    const list = k ? top.filter((p) => p.key.includes(k)) : top;
    $("#board").innerHTML = list.map((p, i) =>
      `<li data-slug="${esc(p.slug)}" style="animation-delay:${Math.min(i, 40) * 15}ms"><span class="n">#${p.rank}</span><span>${esc(p.name)}</span></li>`
    ).join("") || `<li>Không có ai khớp “${esc(filter)}”</li>`;
  }

  // ---------- Pháo giấy ----------
  function confetti(n) {
    const cv = $("#confetti");
    const ctx = cv.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const colors = ["#ffcc33", "#ff9f1c", "#ff4d6d", "#2ee6a6", "#4da3ff", "#ffffff"];
    const parts = Array.from({ length: n }, () => ({
      x: innerWidth / 2 + (Math.random() - 0.5) * 120, y: innerHeight * 0.35,
      vx: (Math.random() - 0.5) * 16, vy: -Math.random() * 16 - 4,
      s: 5 + Math.random() * 6, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4,
      c: colors[(Math.random() * colors.length) | 0],
    }));
    const end = performance.now() + 4500;
    (function frame(t) {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      for (const p of parts) {
        p.vy += 0.35; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r);
        ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
        ctx.restore();
      }
      if (t < end) requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, innerWidth, innerHeight);
    })(performance.now());
  }

  function showFriend(p) {
    const verdict = p.rank && p.rank <= DATA.winners
      ? `đã lọt <b>Top ${DATA.winners}</b> với hạng <b>#${p.rank}</b> 🏆`
      : p.rank ? `về hạng <b>#${p.rank}</b>, chỉ tiếc chưa lọt Top ${DATA.winners}` : "đã thử vận may";
    const box = $("#friend");
    box.innerHTML = `<b>${esc(p.name)}</b> ${verdict}. Đến lượt bạn – nhập tên của bạn bên dưới!
      <button type="button" class="ghost" data-slug="${esc(p.slug)}">Xem hiệu ứng của ${esc(p.name)}</button>`;
    box.classList.remove("hidden");
  }

  // ---------- Sự kiện ----------
  function bind() {
    $("#searchForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const q = $("#q").value;
      showMatches(search(q), q);
    });
    $("#matches").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-slug]");
      if (b) { $("#matches").innerHTML = ""; $("#q").value = ""; runRace(bySlug.get(b.dataset.slug)); }
    });
    $("#board").addEventListener("click", (e) => {
      const li = e.target.closest("li[data-slug]");
      if (li) runRace(bySlug.get(li.dataset.slug));
    });
    $("#friend").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-slug]");
      if (b) runRace(bySlug.get(b.dataset.slug));
    });
    $("#boardFilter").addEventListener("input", (e) => renderBoard(e.target.value));
    $("#result").addEventListener("click", async (e) => {
      const b = e.target.closest("button[data-act]");
      if (!b) return;
      const p = bySlug.get($("#result").dataset.slug);
      const url = shareUrl(p);
      if (b.dataset.act === "fb") {
        window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`, "_blank", "noopener,width=640,height=560");
      } else if (b.dataset.act === "copy") {
        try { await navigator.clipboard.writeText(url); toast("Đã copy link kết quả!"); }
        catch (err) { prompt("Copy link này:", url); }
      } else {
        $("#q").value = "";
        $("#search").scrollIntoView({ behavior: "smooth" });
        $("#q").focus({ preventScroll: true });
      }
    });
  }

  // ---------- Khởi động ----------
  (async function init() {
    bind();
    try { await load(); }
    catch (e) {
      $("#stats").innerHTML = `<span class="stat">⚠️ Không tải được data.json – hãy mở trang qua web server</span>`;
      return;
    }
    renderStats();
    renderPodium();

    // Mở từ link bạn bè chia sẻ (?u=<fb id>): chỉ giới thiệu kết quả của họ,
    // ô tên luôn để trống để người vào tự nhập tên mình.
    const u = new URLSearchParams(location.search).get("u");
    const friend = u && bySlug.get(u.toLowerCase());
    if (friend) showFriend(friend);
    if (location.search) history.replaceState(null, "", location.pathname);
    $("#q").value = "";
    $("#q").focus({ preventScroll: true });
  })();
})();
