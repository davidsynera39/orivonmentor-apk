/* =========================================================================
   Orivon — HTML/CSS/JS frontend, connected to a real backend.
   All data lives in the server's SQLite database via the Express API in
   /server. AI responses come from Anthropic when ANTHROPIC_API_KEY is set
   on the server, or a clearly-labeled mock fallback otherwise. Nothing is
   stored in localStorage anymore — sessions are httpOnly cookies.
   ========================================================================= */

/* ---------------------------- Utilities ---------------------------- */

function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Renders a constrained subset of Markdown (bold, italics, bullet/numbered lists,
// paragraphs) as safe HTML. Input is escaped first, so no raw HTML can be injected —
// only the specific markdown patterns below are converted into tags.
function renderMarkdown(str) {
  if (!str) return "";
  const escaped = escapeHtml(str);
  const lines = escaped.split("\n");
  const blocks = [];
  let listBuffer = [];
  let listType = null;

  function flushList() {
    if (listBuffer.length) {
      blocks.push(`<${listType}>${listBuffer.map((li) => `<li>${li}</li>`).join("")}</${listType}>`);
      listBuffer = [];
      listType = null;
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const bulletMatch = line.match(/^[-*•]\s+(.*)/);
    const numberedMatch = line.match(/^\d+[.)]\s+(.*)/);

    if (bulletMatch) {
      if (listType !== "ul") flushList();
      listType = "ul";
      listBuffer.push(inlineMarkdown(bulletMatch[1]));
    } else if (numberedMatch) {
      if (listType !== "ol") flushList();
      listType = "ol";
      listBuffer.push(inlineMarkdown(numberedMatch[1]));
    } else {
      flushList();
      if (line) blocks.push(`<p>${inlineMarkdown(line)}</p>`);
    }
  }
  flushList();
  return blocks.join("");
}

async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through to the legacy method below */ }

  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function inlineMarkdown(line) {
  return line
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, "<code>$1</code>");
}

function formatDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function qs(sel, root) { return (root || document).querySelector(sel); }
function qsa(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

/* ---------------------------- API client ---------------------------- */
/*
  Thin wrapper around fetch(). Every call sends the session cookie
  (credentials: "include") and returns { ok, status, data } so callers can
  handle errors uniformly without try/catch everywhere.
*/

async function apiRequest(path, options = {}) {
  const opts = { credentials: "include", headers: {}, ...options };
  if (options.body && !(options.body instanceof FormData)) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(options.body);
  }
  let res, data;
  try {
    res = await fetch(path, opts);
  } catch {
    return { ok: false, status: 0, data: { error: "Could not reach the server." } };
  }
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { ok: res.ok, status: res.status, data };
}

const Api = {
  // auth
  me: () => apiRequest("/api/auth/me"),
  register: (body) => apiRequest("/api/auth/register", { method: "POST", body }),
  login: (body) => apiRequest("/api/auth/login", { method: "POST", body }),
  forgotPassword: (body) => apiRequest("/api/auth/forgot-password", { method: "POST", body }),
  resetPassword: (body) => apiRequest("/api/auth/reset-password", { method: "POST", body }),
  verifyEmail: (body) => apiRequest("/api/auth/verify-email", { method: "POST", body }),
  resendVerification: () => apiRequest("/api/auth/resend-verification", { method: "POST" }),
  logout: () => apiRequest("/api/auth/logout", { method: "POST" }),

  // onboarding
  completeOnboarding: (body) => apiRequest("/api/onboarding", { method: "POST", body }),

  // profile
  getProfile: () => apiRequest("/api/profile"),

  // career
  listCareerGoals: () => apiRequest("/api/career"),
  assessCareer: (body) => apiRequest("/api/career", { method: "POST", body }),

  // roadmap
  listRoadmaps: () => apiRequest("/api/roadmap"),
  createRoadmap: (body) => apiRequest("/api/roadmap", { method: "POST", body }),
  getRoadmap: (id) => apiRequest(`/api/roadmap/${id}`),
  toggleRoadmapItem: (id, itemId, completed) =>
    apiRequest(`/api/roadmap/${id}/items/${itemId}`, { method: "PATCH", body: { completed } }),

  // interview
  listInterviews: () => apiRequest("/api/interview"),
  startInterview: (body) => apiRequest("/api/interview", { method: "POST", body }),
  getInterview: (id) => apiRequest(`/api/interview/${id}`),
  answerInterviewQuestion: (id, questionId, answer) =>
    apiRequest(`/api/interview/${id}/questions/${questionId}/answer`, { method: "POST", body: { answer } }),
  completeInterview: (id) => apiRequest(`/api/interview/${id}/complete`, { method: "POST" }),

  // scholarships
  getScholarshipProfile: () => apiRequest("/api/scholarships/profile"),
  saveScholarshipProfile: (body) => apiRequest("/api/scholarships/profile", { method: "PUT", body }),
  listScholarships: () => apiRequest("/api/scholarships"),
  discoverScholarships: () => apiRequest("/api/scholarships/discover", { method: "POST" }),
  listScholarshipApplications: () => apiRequest("/api/scholarships/applications"),
  startScholarshipApplication: (scholarshipId) => apiRequest("/api/scholarships/applications", { method: "POST", body: { scholarshipId } }),
  updateScholarshipApplication: (id, body) => apiRequest(`/api/scholarships/applications/${id}`, { method: "PATCH", body }),

  // research
  listResearchProjects: () => apiRequest("/api/research"),
  createResearchProject: (body) => apiRequest("/api/research", { method: "POST", body }),
  getResearchProject: (id) => apiRequest(`/api/research/${id}`),
  updateResearchProject: (id, body) => apiRequest(`/api/research/${id}`, { method: "PATCH", body }),
  deleteResearchProject: (id) => apiRequest(`/api/research/${id}`, { method: "DELETE" }),
  uploadResearchDocument: (id, file) => {
    const form = new FormData();
    form.append("file", file);
    return apiRequest(`/api/research/${id}/documents`, { method: "POST", body: form });
  },
  deleteResearchDocument: (id, docId) => apiRequest(`/api/research/${id}/documents/${docId}`, { method: "DELETE" }),
  askResearchQuestion: (id, question) => apiRequest(`/api/research/${id}/ask`, { method: "POST", body: { question } }),
  addResearchNote: (id, body) => apiRequest(`/api/research/${id}/notes`, { method: "POST", body }),
  deleteResearchNote: (id, noteId) => apiRequest(`/api/research/${id}/notes/${noteId}`, { method: "DELETE" }),

  // chat
  sendMessage: (body) => apiRequest("/api/chat", { method: "POST", body }),
  listConversations: () => apiRequest("/api/chat"),
  getConversation: (id) => apiRequest(`/api/chat?conversationId=${id}`),

  // cv
  listCvs: () => apiRequest("/api/cv"),
  uploadCv: (file) => {
    const formData = new FormData();
    formData.append("file", file);
    return apiRequest("/api/cv/upload", { method: "POST", body: formData });
  },
  getCv: (id) => apiRequest(`/api/cv/${id}`),
  reviewCv: (id, jobDescription) => apiRequest(`/api/cv/${id}/review`, { method: "POST", body: { jobDescription } }),
  getCvEditor: (id) => apiRequest(`/api/cv/${id}/editor`),
  suggestCvEdit: (id, body) => apiRequest(`/api/cv/${id}/suggest`, { method: "POST", body }),
  saveCvVersion: (id, body) => apiRequest(`/api/cv/${id}/versions`, { method: "POST", body }),
  restoreCvVersion: (id, versionId) => apiRequest(`/api/cv/${id}/versions/${versionId}/restore`, { method: "POST" }),

  // settings
  getPreferences: () => apiRequest("/api/settings/preferences"),
  updatePreferences: (body) => apiRequest("/api/settings/preferences", { method: "PATCH", body }),
  changePassword: (body) => apiRequest("/api/settings/password", { method: "POST", body }),
  updateEmail: (body) => apiRequest("/api/settings/account", { method: "PATCH", body }),
  deleteAccount: (body) => apiRequest("/api/settings/account", { method: "POST", body }),

  // goals / activity
  listGoals: () => apiRequest("/api/goals"),
  addGoal: (body) => apiRequest("/api/goals", { method: "POST", body }),
  getUsage: () => apiRequest("/api/usage"),
  getPaymentPlans: () => apiRequest("/api/payments/plans"),
  initializePayment: (plan) => apiRequest("/api/payments/initialize", { method: "POST", body: { plan: plan || "pro" } }),
  listActivity: (limit) => apiRequest(`/api/activity${limit ? `?limit=${limit}` : ""}`),
};

/* ---------------------------- Session cache ---------------------------- */
/*
  Avoids an /api/auth/me round trip on every single navigation. Cleared or
  updated explicitly on login/register/logout so it never goes stale.
*/

const Session = {
  _user: null,
  _fetched: false,
  _generation: 0,
  _pending: null,

  async get() {
    if (this._fetched) return this._user;
    if (this._pending) return this._pending;

    const startGen = this._generation;
    this._pending = (async () => {
      const res = await Api.me();
      if (this._generation === startGen) {
        this._user = res.ok ? res.data.user : null;
        this._fetched = true;
      }
      this._pending = null;
      return this._user;
    })();
    return this._pending;
  },

  set(user) {
    this._user = user;
    this._fetched = true;
    this._generation++;
    this._pending = null;
  },

  clear() {
    this._user = null;
    this._fetched = true;
    this._generation++;
    this._pending = null;
  },
};

/* ============================================================================
   Router
   Hashes starting with "#/" are app routes. Plain hashes (e.g. "#how") are
   left alone so in-page anchor links on the landing page work natively.
   View handlers may be async — the router doesn't await them, they render
   whenever their data arrives.
   ============================================================================ */

const Router = {
  routes: [],

  add(pattern, handler) {
    const paramNames = [];
    const regexStr = pattern.replace(/:[a-zA-Z]+/g, (m) => {
      paramNames.push(m.slice(1));
      return "([^/]+)";
    });
    this.routes.push({ regex: new RegExp("^" + regexStr + "$"), paramNames, handler });
  },

  navigate(path) {
    window.location.hash = "#" + path;
  },

  currentQuery() {
    const hash = window.location.hash || "";
    const qIndex = hash.indexOf("?");
    if (qIndex === -1) return {};
    return Object.fromEntries(new URLSearchParams(hash.slice(qIndex + 1)));
  },

  resolve() {
    const hash = window.location.hash || "#/";
    if (!hash.startsWith("#/")) return;
    const path = hash.slice(1).split("?")[0] || "/";
    for (const route of this.routes) {
      const match = path.match(route.regex);
      if (match) {
        const params = {};
        route.paramNames.forEach((name, i) => { params[name] = decodeURIComponent(match[i + 1]); });
        route.handler(params);
        return;
      }
    }
    Views.notFound();
  },

  init() {
    if (this._initialized) return;
    this._initialized = true;
    window.addEventListener("hashchange", () => this.resolve());
    if (!window.location.hash) window.location.hash = "#/";
    this.resolve();
  },
};

function mount(html) {
  qs("#app").innerHTML = html;
  window.scrollTo(0, 0);
}

/* Guards against slow async views (dashboard, career, etc.) rendering
   after the user has already navigated elsewhere — without this, a
   late-resolving fetch from an abandoned view can overwrite whatever
   page is now on screen. */
function isActivePath(path) {
  const hash = window.location.hash || "";
  return hash === "#" + path || hash.startsWith("#" + path + "/") || hash.startsWith("#" + path + "?");
}

/* Guards */
async function requireAuth(cb) {
  const user = await Session.get();
  if (!user) { Router.navigate("/login"); return; }
  if (!user.emailVerified) { Router.navigate("/verify-email-pending"); return; }
  if (!user.onboardingCompleted) { Router.navigate("/onboarding"); return; }
  cb(user);
}
async function redirectIfAuthed() {
  const user = await Session.get();
  if (user) { Router.navigate(!user.emailVerified ? "/verify-email-pending" : user.onboardingCompleted ? "/dashboard" : "/onboarding"); return true; }
  return false;
}

/* ============================================================================
   Views
   ============================================================================ */

const Views = {};

Views.notFound = function () {
  mount(`
    <div class="auth-shell">
      <div class="auth-brand">Orivon</div>
      <div class="auth-card" style="text-align:center;">
        <h1>Page not found</h1>
        <p class="sub mt-8">That page doesn't exist in this prototype.</p>
        <a href="#/" class="btn btn-primary mt-24">Back home</a>
      </div>
    </div>
  `);
};

Views.landing = function () {
  const capabilities = [
    ["01", "Chat", "A general guide that already knows your goals, so you never start from zero."],
    ["02", "Career Guidance", "Explore paths, understand what they require, and see where you stand today."],
    ["03", "Learning Roadmaps", "A structured path from where you are to where you're going, built around your time."],
    ["04", "CV Review", "Honest, specific feedback — matched against the role you actually want."],
    ["05", "Interview Prep", "Practice with a mock interview that adapts, and feedback you can act on."],
    ["06", "Scholarships", "Find opportunities that fit your profile, and prepare each application properly."],
    ["07", "Research Assistant", "Read, question, and organize your sources — without losing the thread."],
  ];
  const journey = [
    ["Tell Orivon your goal", "\u201cI want to become a frontend developer within the year.\u201d"],
    ["Get a plan, not a list of tools", "Career direction, a learning roadmap, and what to prepare next."],
    ["Move through it in order", "Roadmap \u2192 CV \u2192 mock interview \u2192 real opportunities, all connected."],
    ["See your own progress", "One dashboard that tracks what you've actually done."],
  ];
  const faqs = [
    ["Is Orivon seven separate tools?", "No. It's one guidance system with shared context — career guidance can hand off directly into a roadmap, CV review, or interview prep."],
    ["Is this a real AI model?", "Yes — this frontend talks to a real Express server backed by a SQLite database, with AI responses generated by Anthropic's Claude when an API key is configured on the server (otherwise a clearly-labeled placeholder is shown)."],
    ["Where is my data stored?", "In a real database on the server, tied to your authenticated session — not in your browser."],
  ];

  mount(`
    <header class="topbar">
      <div class="topbar-inner">
        <a href="#/" class="brand">Orivon</a>
        <nav class="topbar-links">
          <a href="#how">How it works</a>
          <a href="#capabilities">Capabilities</a>
          <a href="#pricing">Pricing</a>
          <a href="#faq">FAQ</a>
        </nav>
        <div class="topbar-actions">
          <a href="#/login" class="btn btn-ghost">Log in</a>
          <a href="#/register" class="btn btn-primary">Get started</a>
        </div>
      </div>
    </header>

    <section class="hero container">
      <div class="hero-eyebrow">A guidance platform, not a toolbox</div>
      <h1>Your AI guide for <em>learning</em>, <em>career</em>, and <em>opportunity</em>.</h1>
      <p class="hero-sub">Get personalized guidance, build the skills you need, prepare for opportunities, and move toward your goals with Orivon.</p>
      <div class="hero-cta">
        <a href="#/register" class="btn btn-primary btn-lg">Start your plan</a>
        <a href="#how" class="link">See how it works &rarr;</a>
      </div>

      <div class="preview-frame">
        <div class="preview-inner">
          <div class="preview-grid">
            <div>
              <p class="eyebrow">Good morning, David</p>
              <p class="display mt-8" style="font-size:22px;">Become a job-ready frontend developer</p>
              <div class="mt-24">
                <p class="eyebrow">Learning progress</p>
                <div class="progress-track"><div class="progress-fill" style="width:72%"></div></div>
                <p class="small muted mt-8">72% through your roadmap</p>
              </div>
            </div>
            <div>
              <p class="eyebrow">Recommended next</p>
              <div class="action-row"><span>Complete JavaScript fundamentals</span><span style="color:var(--moss)">&rarr;</span></div>
              <div class="action-row"><span>Update your CV for this role</span><span style="color:var(--moss)">&rarr;</span></div>
              <div class="action-row"><span>Practice frontend interview questions</span><span style="color:var(--moss)">&rarr;</span></div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="section section-tinted" id="how">
      <div class="container">
        <h2>One goal in. A connected plan out.</h2>
        <p class="section-lead">You don't need to know which tool you need. Tell Orivon what you're trying to achieve.</p>
        <div class="journey-grid">
          ${journey.map(([step, detail], i) => `
            <div>
              <div class="journey-num">${i + 1}</div>
              <p class="journey-step">${step}</p>
              <p class="journey-detail">${detail}</p>
            </div>
          `).join("")}
        </div>
      </div>
    </section>

    <section class="section" id="capabilities">
      <div class="container">
        <h2>Seven capabilities. One guide.</h2>
        <p class="section-lead">Each one shares what it needs to know about you — nothing more.</p>
        <div class="cap-grid">
          ${capabilities.map(([n, name, desc]) => `
            <div class="cap-card">
              <p class="cap-num">${n}</p>
              <p class="cap-name">${name}</p>
              <p class="cap-desc">${desc}</p>
            </div>
          `).join("")}
        </div>
      </div>
    </section>

    <section class="section section-dark">
      <div class="container benefit-grid">
        <div>
          <p class="benefit-title">Context that carries over</p>
          <p class="mt-8">Tell Orivon once. It's remembered everywhere it's relevant — never repeated back to you.</p>
        </div>
        <div>
          <p class="benefit-title">Guidance, not guesses</p>
          <p class="mt-8">Recommendations are clearly labeled as guidance. Facts stay facts.</p>
        </div>
        <div>
          <p class="benefit-title">Progress you can see</p>
          <p class="mt-8">One dashboard tracks what you've actually done — no leaderboards, no noise.</p>
        </div>
      </div>
    </section>

    <section class="section" id="pricing">
      <div class="container">
        <h2>Start free. Upgrade when you need more.</h2>
        <div class="pricing-grid">
          <div class="price-card">
            <p class="price-title">Free</p>
            <p class="price-amount">₦0<span>/month</span></p>
            <p class="price-sub">Enough to get moving on your goal.</p>
            <ul class="price-features">
              <li>AI Chat</li><li>Basic career guidance</li><li>Limited CV reviews</li>
              <li>Limited interview prep</li><li>Basic learning roadmaps</li>
            </ul>
            <a href="#/register" class="btn btn-secondary btn-block mt-24">Get started</a>
          </div>
          <div class="price-card pro">
            <p class="price-title">Pro</p>
            <p class="price-amount">₦5,000<span>/month</span></p>
            <p class="price-sub">Full depth across every capability.</p>
            <ul class="price-features">
              <li>Everything in Free, expanded</li><li>Advanced CV &amp; interview analysis</li>
              <li>Scholarship discovery &amp; assistance</li><li>Advanced research workspace</li>
              <li>Persistent AI context</li>
            </ul>
            <a href="#/payment" class="btn btn-primary btn-block mt-24">Upgrade to Pro</a>
          </div>
        </div>
      </div>
    </section>

    <section class="section section-tinted" id="faq">
      <div class="container-sm">
        <h2>Questions</h2>
        ${faqs.map(([q, a]) => `
          <div class="faq-item">
            <p class="faq-q">${q}</p>
            <p class="faq-a">${a}</p>
          </div>
        `).join("")}
      </div>
    </section>

    <section class="section cta-final">
      <div class="container-sm">
        <h2>What are you trying to achieve?</h2>
        <p class="section-lead">Tell Orivon, and let it show you the way there.</p>
        <a href="#/register" class="btn btn-primary btn-lg mt-24">Start your plan</a>
      </div>
    </section>

    <footer class="footer">
      <div class="container footer-inner">
        <span class="brand" style="font-size:16px;">Orivon</span>
        <span>&copy; 2026 Orivon. A personal guide for learning, career, and opportunity.</span>
      </div>
    </footer>
  `);
};


Views.register = function () {
  redirectIfAuthed().then((redirected) => {
    if (redirected || !isActivePath("/register")) return;
    mount(`
      <div class="auth-shell">
        <a href="#/" class="auth-brand">Orivon</a>
        <div class="auth-card">
          <h1>Create your account</h1>
          <p class="sub">A few details, then we'll get to know your goals.</p>
          <form id="register-form" class="mt-24">
            <div class="field"><label>Name</label><input type="text" id="reg-name" required autocomplete="name" /></div>
            <div class="field"><label>Email</label><input type="email" id="reg-email" required autocomplete="email" /></div>
            <div class="field"><label>Password</label><input type="password" id="reg-password" required minlength="8" autocomplete="new-password" />
              <span class="hint">At least 8 characters.</span></div>
            <div class="field"><label>Confirm password</label><input type="password" id="reg-confirm" required autocomplete="new-password" /></div>
            <div class="field"><label class="check-row"><input type="checkbox" id="reg-agree" /> I agree to the <a href="#/terms" target="_blank">Terms of Service and Privacy Policy</a>.</label></div>
            <p id="reg-error" class="form-error hidden"></p>
            <button type="submit" class="btn btn-primary btn-block mt-16" id="reg-submit">Create account</button>
          </form>
        </div>
        <p class="auth-foot">Already have an account? <a href="#/login">Log in</a></p>
      </div>
    `);

    qs("#register-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = qs("#reg-name").value.trim();
      const email = qs("#reg-email").value.trim();
      const password = qs("#reg-password").value;
      const confirm = qs("#reg-confirm").value;
      const agreed = qs("#reg-agree").checked;
      const errEl = qs("#reg-error");
      const showError = (msg) => { errEl.textContent = msg; errEl.classList.remove("hidden"); };

      if (password.length < 8) return showError("Password must be at least 8 characters.");
      if (password !== confirm) return showError("Passwords don't match.");
      if (!agreed) return showError("Please accept the terms to continue.");

      const btn = qs("#reg-submit");
      btn.disabled = true; btn.textContent = "Creating account…";
      const res = await Api.register({ name, email, password });
      if (!res.ok) {
        showError(res.data?.error || "Something went wrong.");
        btn.disabled = false; btn.textContent = "Create account";
        return;
      }
      Session.set({ ...res.data.user, onboardingCompleted: false });
      Router.navigate("/verify-email-pending");
    });
  });
};

Views.login = function () {
  redirectIfAuthed().then((redirected) => {
    if (redirected || !isActivePath("/login")) return;
    mount(`
      <div class="auth-shell">
        <a href="#/" class="auth-brand">Orivon</a>
        <div class="auth-card">
          <h1>Welcome back</h1>
          <p class="sub">Log in to pick up where you left off.</p>
          <form id="login-form" class="mt-24">
            <div class="field"><label>Email</label><input type="email" id="login-email" required autocomplete="email" /></div>
            <div class="field"><label>Password</label><input type="password" id="login-password" required autocomplete="current-password" /></div>
            <div class="row-between small">
              <label class="check-row"><input type="checkbox" checked /> Remember me</label>
              <a href="#/forgot-password" class="muted">Forgot password?</a>
            </div>
            <p id="login-error" class="form-error hidden"></p>
            <button type="submit" class="btn btn-primary btn-block mt-16" id="login-submit">Log in</button>
          </form>
        </div>
        <p class="auth-foot">Don't have an account? <a href="#/register">Create one</a></p>
      </div>
    `);

    qs("#login-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = qs("#login-email").value.trim();
      const password = qs("#login-password").value;
      const btn = qs("#login-submit");
      btn.disabled = true; btn.textContent = "Logging in…";

      const res = await Api.login({ email, password });
      if (!res.ok) {
        const errEl = qs("#login-error");
        errEl.textContent = res.data?.error || "Something went wrong.";
        errEl.classList.remove("hidden");
        btn.disabled = false; btn.textContent = "Log in";
        return;
      }
      Session.set(res.data.user);
      Router.navigate(!res.data.user.emailVerified ? "/verify-email-pending" : res.data.user.onboardingCompleted ? "/dashboard" : "/onboarding");
    });
  });
};

/* ---------------------------- Onboarding ---------------------------- */

const GOAL_OPTIONS = [
  ["get-job", "Get a job"], ["change-careers", "Change careers"], ["learn-skill", "Learn a skill"],
  ["prepare-interview", "Prepare for an interview"], ["improve-cv", "Improve my CV"],
  ["find-scholarships", "Find scholarships"], ["conduct-research", "Conduct research"],
  ["start-learning", "Start learning"], ["explore-careers", "Explore career options"], ["other", "Other"],
];

const SITUATION_FIELDS = {
  "get-job": [["targetRole", "Target role", "e.g. Frontend Developer"], ["industry", "Industry", "e.g. Technology"],
    ["experienceLevel", "Experience level", "e.g. Entry-level"], ["currentSkills", "Current skills", "Comma-separated, e.g. HTML, CSS"],
    ["locationPref", "Location preference", "e.g. Remote, Berlin"]],
  "change-careers": [["targetRole", "Target role", "What are you moving toward?"], ["industry", "Industry", "e.g. Technology"],
    ["currentSkills", "Transferable skills", "Comma-separated"]],
  "learn-skill": [["skill", "Skill", "e.g. React"], ["currentLevel", "Current level", "e.g. Beginner"],
    ["desiredLevel", "Desired level", "e.g. Job-ready"], ["targetCompletionDate", "Target completion date", "YYYY-MM-DD"]],
  "start-learning": [["skill", "What do you want to learn?", "e.g. Data analysis"], ["currentLevel", "Current level", "e.g. No experience"]],
  "prepare-interview": [["targetRole", "Role you're interviewing for", "e.g. Backend Engineer"], ["experienceLevel", "Experience level", ""]],
  "improve-cv": [["targetRole", "Target role for your CV", "e.g. Product Manager"]],
  "find-scholarships": [["targetRole", "Target degree / program", "e.g. MSc Computer Science"], ["locationPref", "Preferred study destination", ""]],
  "conduct-research": [["targetRole", "Research area", "e.g. Renewable energy policy"]],
  "explore-careers": [["currentSkills", "Interests or existing skills", "Comma-separated"]],
  "other": [["targetRole", "Briefly describe your goal", ""]],
};

const GOAL_LABELS = Object.fromEntries(GOAL_OPTIONS);

function deriveGoalTitle(goalKey, situation) {
  if (situation.targetRole) return situation.targetRole;
  if (situation.skill) return `Learn ${situation.skill}`;
  return GOAL_LABELS[goalKey] || "A personal goal";
}

Views.onboarding = function () {
  Session.get().then((user) => {
    if (!user) { Router.navigate("/login"); return; }
    if (!user.emailVerified) { Router.navigate("/verify-email-pending"); return; }

    const state = {
      step: 1,
      aboutYou: { educationLevel: "", fieldOfStudy: "", institution: "", graduationYear: "", occupationStatus: "", experienceLevel: "" },
      selectedGoals: [],
      situation: {},
    };

    function render() {
      const primaryGoal = state.selectedGoals[0];
      const fields = primaryGoal ? (SITUATION_FIELDS[primaryGoal] || []) : [];

      mount(`
        <div class="ob-shell">
          <div class="ob-card container-sm">
            <div class="ob-steps">
              ${[1, 2, 3, 4].map((s) => `<div class="ob-step-dot ${s <= state.step ? "done" : ""}"></div>`).join("")}
            </div>
            <div id="ob-step-content"></div>
          </div>
        </div>
      `);

      const content = qs("#ob-step-content");

      if (state.step === 1) {
        content.innerHTML = `
          <p class="eyebrow eyebrow-accent">Step 1 of 4</p>
          <h1 class="mt-8" style="font-size:28px;">About you</h1>
          <p class="muted mt-8">This helps Orivon personalize everything else. All fields are optional.</p>
          <div class="grid-2 mt-24">
            <div class="field"><label>Education level</label>
              <select id="ob-education">
                <option value="">Select…</option>
                ${["High school", "Bachelor's", "Master's", "PhD", "Other"].map((l) => `<option ${state.aboutYou.educationLevel === l ? "selected" : ""}>${l}</option>`).join("")}
              </select>
            </div>
            <div class="field"><label>Field of study</label><input type="text" id="ob-field" value="${escapeHtml(state.aboutYou.fieldOfStudy)}" /></div>
            <div class="field"><label>Institution</label><input type="text" id="ob-institution" value="${escapeHtml(state.aboutYou.institution)}" /></div>
            <div class="field"><label>Graduation year</label><input type="number" id="ob-gradyear" value="${escapeHtml(state.aboutYou.graduationYear)}" /></div>
            <div class="field"><label>Current status</label>
              <select id="ob-status">
                <option value="">Select…</option>
                ${["Student", "Employed", "Job-seeking", "Freelancing", "Other"].map((l) => `<option ${state.aboutYou.occupationStatus === l ? "selected" : ""}>${l}</option>`).join("")}
              </select>
            </div>
            <div class="field"><label>Experience level</label><input type="text" id="ob-explevel" placeholder="e.g. Entry-level" value="${escapeHtml(state.aboutYou.experienceLevel)}" /></div>
          </div>
          <div class="ob-actions"><span></span><button class="btn btn-primary" id="ob-next-1">Continue</button></div>
        `;
        qs("#ob-next-1").addEventListener("click", () => {
          state.aboutYou = {
            educationLevel: qs("#ob-education").value, fieldOfStudy: qs("#ob-field").value,
            institution: qs("#ob-institution").value, graduationYear: qs("#ob-gradyear").value,
            occupationStatus: qs("#ob-status").value, experienceLevel: qs("#ob-explevel").value,
          };
          state.step = 2; render();
        });
      }

      else if (state.step === 2) {
        content.innerHTML = `
          <p class="eyebrow eyebrow-accent">Step 2 of 4</p>
          <h1 class="mt-8" style="font-size:28px;">What are you trying to achieve?</h1>
          <p class="muted mt-8">Select everything that applies. Your first choice becomes your primary goal.</p>
          <div class="ob-goal-grid">
            ${GOAL_OPTIONS.map(([key, label]) => {
              const idx = state.selectedGoals.indexOf(key);
              const selected = idx !== -1;
              return `<button type="button" class="goal-btn ${selected ? "selected" : ""}" data-goal="${key}">
                <span>${label}</span>${selected ? `<span class="order-badge">${idx === 0 ? "Primary" : "#" + (idx + 1)}</span>` : ""}
              </button>`;
            }).join("")}
          </div>
          <div class="ob-actions">
            <button class="btn btn-ghost" id="ob-back-2">Back</button>
            <button class="btn btn-primary" id="ob-next-2" ${state.selectedGoals.length === 0 ? "disabled" : ""}>Continue</button>
          </div>
        `;
        qsa(".goal-btn", content).forEach((btn) => btn.addEventListener("click", () => {
          const key = btn.dataset.goal;
          const idx = state.selectedGoals.indexOf(key);
          if (idx === -1) state.selectedGoals.push(key); else state.selectedGoals.splice(idx, 1);
          render();
        }));
        qs("#ob-back-2").addEventListener("click", () => { state.step = 1; render(); });
        qs("#ob-next-2").addEventListener("click", () => { state.step = 3; render(); });
      }

      else if (state.step === 3) {
        content.innerHTML = `
          <p class="eyebrow eyebrow-accent">Step 3 of 4</p>
          <h1 class="mt-8" style="font-size:28px;">Your current situation</h1>
          <p class="muted mt-8">Just what's relevant to your primary goal.</p>
          <div class="mt-24">
            ${fields.length === 0 ? `<p class="muted">No additional details needed — you're all set.</p>` :
              fields.map(([key, label, placeholder]) => `
                <div class="field"><label>${label}</label>
                  <input type="text" data-key="${key}" class="ob-situation-input" placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(state.situation[key] || "")}" />
                </div>
              `).join("")}
          </div>
          <p id="ob-error" class="form-error hidden mt-8"></p>
          <div class="ob-actions">
            <button class="btn btn-ghost" id="ob-back-3">Back</button>
            <button class="btn btn-primary" id="ob-finish">Personalize Orivon</button>
          </div>
        `;
        qs("#ob-back-3").addEventListener("click", () => { state.step = 2; render(); });
        qs("#ob-finish").addEventListener("click", async () => {
          qsa(".ob-situation-input", content).forEach((input) => { state.situation[input.dataset.key] = input.value; });
          const btn = qs("#ob-finish");
          btn.disabled = true; btn.textContent = "Personalizing…";
          await finishOnboarding();
        });
      }

      else if (state.step === 4) {
        const primaryGoalTitle = deriveGoalTitle(primaryGoal, state.situation);
        content.innerHTML = `
          <p class="eyebrow eyebrow-accent">Step 4 of 4</p>
          <h1 class="mt-8" style="font-size:28px;">You're all set</h1>
          <p class="muted mt-8">Here's what Orivon understands so far. You can edit this anytime.</p>
          <div class="ob-summary">
            <div class="ob-summary-item"><p class="ob-summary-label">Primary goal</p><p class="ob-summary-value">${escapeHtml(primaryGoalTitle)}</p></div>
            <div class="ob-summary-item"><p class="ob-summary-label">Current level</p><p>${escapeHtml(state.situation.currentLevel || state.situation.experienceLevel || state.aboutYou.experienceLevel || "Beginner")}</p></div>
            <div class="ob-summary-item"><p class="ob-summary-label">Recommended starting point</p><p>Your Orivon Dashboard, with next actions ready.</p></div>
          </div>
          <div class="ob-actions"><span></span><button class="btn btn-primary" id="ob-go-dashboard">Go to my dashboard</button></div>
        `;
        qs("#ob-go-dashboard").addEventListener("click", () => Router.navigate("/dashboard"));
      }
    }

    async function finishOnboarding() {
      const primaryGoal = state.selectedGoals[0];
      const graduationYear = state.aboutYou.graduationYear ? Number(state.aboutYou.graduationYear) : undefined;

      const res = await Api.completeOnboarding({
        aboutYou: { ...state.aboutYou, graduationYear },
        goals: state.selectedGoals,
        situation: state.situation,
      });

      if (!res.ok) {
        const errEl = qs("#ob-error");
        errEl.textContent = res.data?.error || "Something went wrong.";
        errEl.classList.remove("hidden");
        const btn = qs("#ob-finish");
        if (btn) { btn.disabled = false; btn.textContent = "Personalize Orivon"; }
        return;
      }

      const current = await Session.get();
      Session.set({ ...current, onboardingCompleted: true });

      state.step = 4;
      render();
    }

    render();
  });
};

/* ---------------------------- App shell (sidebar) ---------------------------- */

const NAV_SECTIONS = [
  { items: [["/dashboard", "Dashboard"], ["/chat", "Chat"]] },
  { title: "Guidance", items: [["/career", "Career Guidance"], ["/roadmap", "Learning Roadmaps"], ["/cv", "CV Review"], ["/interview", "Interview Prep"], ["/scholarships", "Scholarships"], ["/research", "Research Assistant"]] },
  { title: "You", items: [["/goals", "Goals"], ["/activity", "Activity"]] },
];

function renderShell(user, activePath, innerHtml) {
  mount(`
    <div class="app-shell">
      <div class="mobile-topbar">
        <button class="hamburger-btn" id="hamburger-toggle" aria-label="Open menu">
          <span></span><span></span><span></span>
        </button>
        <a href="#/dashboard" class="brand">Orivon</a>
      </div>
      <div class="sidebar-overlay" id="sidebar-overlay"></div>
      <aside class="sidebar" id="app-sidebar">
        <div class="sidebar-head"><a href="#/dashboard" class="brand">Orivon</a></div>
        <nav class="sidebar-nav">
          ${NAV_SECTIONS.map((section) => `
            <div class="nav-section">
              ${section.title ? `<p class="nav-section-title">${section.title}</p>` : ""}
              <div class="nav-items">
                ${section.items.map(([href, label]) => `
                  <a href="#${href}" class="nav-link ${activePath === href || activePath.startsWith(href + "/") ? "active" : ""}">${label}</a>
                `).join("")}
              </div>
            </div>
          `).join("")}
        </nav>
        <div class="sidebar-foot">
          <a href="#/settings" class="nav-link ${activePath === "/settings" ? "active" : ""}">Settings</a>
          <div class="nav-link" style="font-weight:500;">${escapeHtml(user.name)}</div>
          <button class="nav-link" id="shell-logout" style="width:100%;">Log out</button>
        </div>
      </aside>
      <main class="main-content">${innerHtml}</main>
    </div>
  `);
  qs("#shell-logout").addEventListener("click", async () => {
    await Api.logout();
    Session.clear();
    Router.navigate("/");
  });

  const sidebar = qs("#app-sidebar");
  const overlay = qs("#sidebar-overlay");
  const hamburger = qs("#hamburger-toggle");
  const openSidebar = () => { sidebar.classList.add("sidebar-open"); overlay.classList.add("visible"); };
  const closeSidebar = () => { sidebar.classList.remove("sidebar-open"); overlay.classList.remove("visible"); };
  hamburger.addEventListener("click", openSidebar);
  overlay.addEventListener("click", closeSidebar);
  qsa(".nav-link", sidebar).forEach((link) => link.addEventListener("click", closeSidebar));
}

/* ---------------------------- Dashboard ---------------------------- */

Views.dashboard = function () {
  requireAuth(async (user) => {
    renderShell(user, "/dashboard", `<div class="page"><p class="loading-text">Loading your dashboard…</p></div>`);

    const [profileRes, roadmapsRes, goalsRes, activityRes, cvsRes] = await Promise.all([
      Api.getProfile(), Api.listRoadmaps(), Api.listGoals(), Api.listActivity(4), Api.listCvs(),
    ]);
    const profile = profileRes.ok ? profileRes.data.profile : {};
    const roadmaps = roadmapsRes.ok ? roadmapsRes.data.roadmaps : [];
    const goals = (goalsRes.ok ? goalsRes.data.goals : []).slice(0, 5);
    const recentActivity = activityRes.ok ? activityRes.data.activities : [];
    const hasCv = cvsRes.ok && cvsRes.data.cvs.length > 0;

    let activeRoadmap = null;
    let progress = 0;
    if (roadmaps[0]) {
      const detail = await Api.getRoadmap(roadmaps[0].id);
      if (detail.ok) {
        activeRoadmap = detail.data.roadmap;
        const items = activeRoadmap.items || [];
        progress = items.length ? Math.round((items.filter((i) => i.completed).length / items.length) * 100) : 0;
      }
    }


    const nextActions = [];
    if (!activeRoadmap) nextActions.push(["/roadmap", "Create your learning roadmap"]);
    if (!hasCv) nextActions.push(["/cv", "Upload your CV for review"]);
    if (["get-job", "change-careers"].includes(profile.primaryGoalType)) nextActions.push(["/career", "Explore your career path"]);
    if (nextActions.length === 0) nextActions.push(["/chat", "Ask Orivon what to do next"]);

    const hour = new Date().getHours();
    const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

    if (!isActivePath("/dashboard")) return; // user navigated away while this was loading

    renderShell(user, "/dashboard", `
      <div class="page">
        <p class="small muted">${greeting}, ${escapeHtml(user.name.split(" ")[0])}.</p>
        <h1 class="display mt-8" style="font-size:28px;">${escapeHtml(profile.primaryGoalTitle || "Let's set your first goal")}</h1>

        <div class="two-col mt-32">
          <div>
            <div class="card">
              <p class="eyebrow">Learning progress</p>
              ${activeRoadmap ? `
                <div class="progress-track"><div class="progress-fill" style="width:${progress}%"></div></div>
                <p class="small muted mt-8">${progress}% through ${escapeHtml(activeRoadmap.title)}</p>
              ` : `
                <p class="small muted mt-8">Turn your goal into a step-by-step learning plan.</p>
                <a href="#/roadmap" class="btn btn-secondary mt-12">Create roadmap</a>
              `}
            </div>
            <div class="card">
              <p class="eyebrow">Recommended next actions</p>
              ${nextActions.slice(0, 4).map(([href, label]) => `
                <a href="#${href}" class="action-row" style="text-decoration:none;"><span>${label}</span><span style="color:var(--moss)">&rarr;</span></a>
              `).join("")}
            </div>
          </div>
          <div>
            <div class="card">
              <div class="row-between"><p class="eyebrow">Your goals</p><a href="#/goals" class="small" style="color:var(--moss-deep);font-weight:500;">View all</a></div>
              ${goals.length === 0 ? `
                <p class="small muted mt-8">You haven't defined a goal yet.</p>
                <a href="#/goals" class="btn btn-secondary btn-block mt-12">Add a goal</a>
              ` : goals.map((g) => `
                <div class="row-between small mt-12"><span>${escapeHtml(g.title)}</span><span class="tag tag-neutral">${g.status}</span></div>
              `).join("")}
            </div>
            <div class="card">
              <div class="row-between"><p class="eyebrow">Recent activity</p><a href="#/activity" class="small" style="color:var(--moss-deep);font-weight:500;">View all</a></div>
              ${recentActivity.length === 0 ? `<p class="small muted mt-8">Nothing yet — your activity will show up here.</p>` :
                recentActivity.map((a) => `
                  <div class="mt-12"><p class="small">${escapeHtml(a.summary)}</p><p class="small muted">${formatDate(a.createdAt)}</p></div>
                `).join("")}
            </div>
          </div>
        </div>
      </div>
    `);
  });
};

/* ---------------------------- Goals & Activity ---------------------------- */

Views.goals = function () {
  requireAuth(async (user) => {
    renderShell(user, "/goals", `<div class="page"><p class="loading-text">Loading…</p></div>`);
    const res = await Api.listGoals();
    const goals = res.ok ? res.data.goals : [];
    if (!isActivePath("/goals")) return;

    function renderPage() {
      renderShell(user, "/goals", `
        <div class="page">
          <div class="page-head"><div><h1 class="page-title">Goals</h1><p class="page-sub">Everything you're working toward.</p></div>
            <button class="btn btn-primary" id="add-goal-btn">Add goal</button></div>
          <div id="goal-form-wrap" class="hidden mt-24">
            <div class="card">
              <div class="field"><label>Title</label><input type="text" id="new-goal-title" /></div>
              <div class="field"><label>Type</label>
                <select id="new-goal-type"><option value="custom">Custom</option><option value="career">Career</option><option value="learning">Learning</option><option value="application">Application</option><option value="research">Research</option></select>
              </div>
              <button class="btn btn-primary" id="save-goal-btn">Save goal</button>
            </div>
          </div>
          <div class="mt-24">
            ${goals.length === 0 ? `<div class="card-empty"><p class="display">No goals yet.</p><p class="sub">Add one to start tracking progress.</p></div>` :
              goals.map((g) => `
                <div class="card row-between">
                  <div><p style="font-weight:500;">${escapeHtml(g.title)}</p><p class="small muted">${g.type}</p></div>
                  <span class="tag tag-neutral">${g.status}</span>
                </div>
              `).join("")}
          </div>
        </div>
      `);
      qs("#add-goal-btn").addEventListener("click", () => qs("#goal-form-wrap").classList.toggle("hidden"));
      qs("#save-goal-btn").addEventListener("click", async () => {
        const title = qs("#new-goal-title").value.trim();
        if (!title) return;
        await Api.addGoal({ title, type: qs("#new-goal-type").value });
        const refreshed = await Api.listGoals();
        if (refreshed.ok) { goals.length = 0; goals.push(...refreshed.data.goals); }
        renderPage();
      });
    }

    renderPage();
  });
};

Views.activity = function () {
  requireAuth(async (user) => {
    renderShell(user, "/activity", `<div class="page"><p class="loading-text">Loading…</p></div>`);
    const res = await Api.listActivity();
    const activity = res.ok ? res.data.activities : [];
    if (!isActivePath("/activity")) return;
    renderShell(user, "/activity", `
      <div class="page">
        <h1 class="page-title">Activity</h1><p class="page-sub">A timeline of what you've done in Orivon.</p>
        <div class="mt-24">
          ${activity.length === 0 ? `<div class="card-empty"><p class="display">No activity yet.</p></div>` :
            activity.map((a) => `<div class="card"><p>${escapeHtml(a.summary)}</p><p class="small muted mt-8">${formatDate(a.createdAt)}</p></div>`).join("")}
        </div>
      </div>
    `);
  });
};

/* ---------------------------- Chat ---------------------------- */

Views.chat = function () {
  requireAuth((user) => {
    let conversationId = null;
    let messages = [];
    let conversations = [];
    let loadingHistory = true;
    let sidebarOpen = false;

    async function loadHistory() {
      const listRes = await Api.listConversations();
      if (listRes.ok) {
        conversations = listRes.data.conversations
          .filter((c) => c.context === "chat")
          .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
        const mostRecent = conversations[0];
        if (mostRecent) {
          const convoRes = await Api.getConversation(mostRecent.id);
          if (convoRes.ok) {
            conversationId = mostRecent.id;
            messages = convoRes.data.messages.map((m) => ({ role: m.role, content: m.content }));
          }
        }
      }
      loadingHistory = false;
      if (!isActivePath("/chat")) return;
      renderHistory();
      renderSidebarList();
    }

    async function switchToConversation(id) {
      if (id === conversationId) { sidebarOpen = false; syncSidebarOpenClass(); return; }
      loadingHistory = true;
      renderHistory();
      const convoRes = await Api.getConversation(id);
      loadingHistory = false;
      if (!convoRes.ok) { renderHistory(); return; }
      conversationId = id;
      messages = convoRes.data.messages.map((m) => ({ role: m.role, content: m.content }));
      sidebarOpen = false;
      syncSidebarOpenClass();
      renderHistory();
      renderSidebarList();
    }

    function startNewChat() {
      conversationId = null;
      messages = [];
      sidebarOpen = false;
      syncSidebarOpenClass();
      renderHistory();
      renderSidebarList();
    }

    function syncSidebarOpenClass() {
      const sb = qs("#chat-sidebar");
      const ov = qs("#chat-sidebar-overlay");
      if (!sb) return;
      sb.classList.toggle("open", sidebarOpen);
      ov.classList.toggle("visible", sidebarOpen);
    }

    function renderPage() {
      renderShell(user, "/chat", `
        <div class="chat-page">
          <div class="chat-shell">
            <div class="flex-between">
              <div><h1 class="page-title">Chat</h1><p class="page-sub">Your general Orivon assistant — powered by a real AI backend.</p></div>
              <button class="btn btn-secondary btn-small chat-history-toggle" id="chat-history-toggle">History</button>
            </div>
            <div class="chat-history mt-16" id="chat-history"></div>
            <p id="chat-error" class="form-error hidden"></p>
            <div class="chat-input-row">
              <textarea id="chat-input" rows="1" placeholder="Ask Orivon anything…"></textarea>
              <button class="btn btn-primary" id="chat-send">Send</button>
            </div>
          </div>
          <div class="chat-sidebar-overlay" id="chat-sidebar-overlay"></div>
          <div class="chat-sidebar" id="chat-sidebar">
            <div class="flex-between">
              <p class="title">History</p>
              <button class="btn btn-secondary btn-small" id="chat-new">New chat</button>
            </div>
            <div class="chat-sidebar-list mt-16" id="chat-sidebar-list"></div>
          </div>
        </div>
      `);
      renderHistory();
      renderSidebarList();
      qs("#chat-send").addEventListener("click", handleSend);
      qs("#chat-new").addEventListener("click", startNewChat);
      qs("#chat-history-toggle").addEventListener("click", () => { sidebarOpen = true; syncSidebarOpenClass(); });
      qs("#chat-sidebar-overlay").addEventListener("click", () => { sidebarOpen = false; syncSidebarOpenClass(); });
      qs("#chat-input").addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
      });
    }

    function renderSidebarList() {
      const el = qs("#chat-sidebar-list");
      if (!el) return;
      if (conversations.length === 0) {
        el.innerHTML = `<p class="small muted">No past conversations yet.</p>`;
        return;
      }
      el.innerHTML = conversations.map((c) => `
        <div class="chat-sidebar-item ${c.id === conversationId ? "active" : ""}" data-convo-id="${c.id}">
          <p class="convo-title">${escapeHtml(c.title || "New conversation")}</p>
          <p class="date">${formatDate(c.updatedAt)}</p>
        </div>
      `).join("");
      qsa(".chat-sidebar-item", el).forEach((item) => item.addEventListener("click", () => switchToConversation(item.dataset.convoId)));
    }

    function renderHistory(pending) {
      const el = qs("#chat-history");
      if (loadingHistory) {
        el.innerHTML = `<p class="loading-text">Loading your conversation…</p>`;
        return;
      }
      if (messages.length === 0 && !pending) {
        const suggestions = ["Help me choose a career direction", "What should I learn next?", "Help me prepare for an interview", "Find scholarships for me", "Help me with my research"];
        el.innerHTML = `
          <div class="chat-empty">
            <p class="display" style="font-size:19px;">What are you trying to accomplish?</p>
            <p class="small muted mt-8">Try one of these, or ask your own question.</p>
            <div class="chat-suggestions">
              ${suggestions.map((s) => `<button class="suggestion-btn" data-suggestion="${escapeHtml(s)}">${s}</button>`).join("")}
            </div>
          </div>
        `;
        qsa(".suggestion-btn", el).forEach((btn) => btn.addEventListener("click", () => {
          if (btn.dataset.suggestion === "Help me prepare for an interview") { Router.navigate("/interview"); return; }
          if (btn.dataset.suggestion === "Find scholarships for me") { Router.navigate("/scholarships"); return; }
          if (btn.dataset.suggestion === "Help me with my research") { Router.navigate("/research"); return; }
          sendMessage(btn.dataset.suggestion);
        }));
      } else {
        el.innerHTML = messages.map((m) => m.role === "assistant" ? `
          <div class="msg-row assistant"><div class="msg-col">
            <div class="msg-bubble">${renderMarkdown(m.content)}</div>
            <button class="msg-copy" type="button">Copy</button>
          </div></div>
        ` : `
          <div class="msg-row ${m.role}"><div class="msg-bubble">${escapeHtml(m.content)}</div></div>
        `).join("") + (pending ? `<div class="msg-row assistant"><div class="msg-bubble muted">Orivon is thinking…</div></div>` : "");

        qsa(".msg-copy", el).forEach((btn) => btn.addEventListener("click", async () => {
          const ok = await copyToClipboard(btn.previousElementSibling.innerText);
          btn.textContent = ok ? "Copied" : "Copy failed";
          setTimeout(() => { btn.textContent = "Copy"; }, 1500);
        }));
        el.scrollTop = el.scrollHeight;
      }
    }

    function handleSend() {
      const input = qs("#chat-input");
      const text = input.value.trim();
      if (!text) return;
      input.value = "";
      sendMessage(text);
    }

    async function sendMessage(text) {
      messages.push({ role: "user", content: text });
      renderHistory(true);
      qs("#chat-error").classList.add("hidden");

      const res = await Api.sendMessage({ conversationId: conversationId || undefined, message: text });
      if (!res.ok) {
        messages.pop();
        renderHistory(false);
        const errEl = qs("#chat-error");
        errEl.textContent = res.data?.error || "Something went wrong.";
        errEl.classList.remove("hidden");
        return;
      }
      const isNewConversation = !conversationId;
      conversationId = res.data.conversationId;
      messages.push({ role: "assistant", content: res.data.reply });
      renderHistory(false);
      if (isNewConversation) {
        const listRes = await Api.listConversations();
        if (listRes.ok) {
          conversations = listRes.data.conversations
            .filter((c) => c.context === "chat")
            .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
          renderSidebarList();
        }
      } else {
        const mine = conversations.find((c) => c.id === conversationId);
        if (mine) { mine.updatedAt = new Date().toISOString(); conversations.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)); renderSidebarList(); }
      }
    }

    renderPage();
    loadHistory();
  });
};

/* ---------------------------- Career Guidance ---------------------------- */

Views.career = function () {
  requireAuth((user) => {
    let showForm = false;
    let goals = [];
    let loading = true;
    let submitting = false;
    let error = null;

    async function load() {
      const res = await Api.listCareerGoals();
      goals = res.ok ? res.data.goals : [];
      loading = false;
      if (!isActivePath("/career")) return;
      renderPage();
    }

    function renderPage() {
      renderShell(user, "/career", `
        <div class="page">
          <div class="page-head">
            <div><h1 class="page-title">Career Guidance</h1><p class="page-sub">Explore paths, understand requirements, and see where you stand.</p></div>
            <button class="btn btn-primary" id="career-toggle-form">${showForm ? "Cancel" : "New assessment"}</button>
          </div>

          <div id="career-form-wrap" class="${showForm ? "" : "hidden"} mt-24">
            <div class="card">
              <div class="grid-2">
                <div class="field"><label>Interests</label><input type="text" id="ca-interests" placeholder="e.g. Building things, design, data" /></div>
                <div class="field"><label>Current skills</label><input type="text" id="ca-skills" placeholder="Comma-separated" /></div>
                <div class="field"><label>Education</label><input type="text" id="ca-education" /></div>
                <div class="field"><label>Experience</label><input type="text" id="ca-experience" /></div>
                <div class="field"><label>Preferred work type</label><input type="text" id="ca-worktype" placeholder="e.g. Remote, in-office" /></div>
                <div class="field"><label>Career goals</label><input type="text" id="ca-goals" placeholder="What outcome are you hoping for?" /></div>
              </div>
              ${error ? `<p class="form-error mt-8">${escapeHtml(error)}</p>` : ""}
              <button class="btn btn-primary mt-16" id="career-submit" ${submitting ? "disabled" : ""}>${submitting ? "Analyzing…" : "Get recommendation"}</button>
            </div>
          </div>

          <div class="mt-24">
            ${loading ? `<p class="loading-text">Loading…</p>` : goals.length === 0 ? `
              <div class="card-empty">
                <p class="display">You haven't defined a career goal yet.</p>
                <p class="sub">Tell Orivon about your interests and skills to get a recommended path.</p>
                <button class="btn btn-primary" id="career-empty-cta">Explore careers</button>
              </div>
            ` : goals.map((g) => `
              <div class="card">
                <p class="eyebrow">Recommended path</p>
                <p class="display mt-8" style="font-size:20px;">${escapeHtml(g.title)}</p>
                ${g.rationale ? `<div class="mt-12"><p class="eyebrow">Why (AI guidance, not a guarantee)</p><p class="small muted mt-8">${escapeHtml(g.rationale)}</p></div>` : ""}
                ${g.skillsNeeded && g.skillsNeeded.length ? `
                  <div class="mt-16"><p class="eyebrow">Skills needed</p>
                  <div class="tag-list">
                    ${g.skillsNeeded.map((s) => `<span class="tag ${g.skillGaps && g.skillGaps.includes(s) ? "tag-danger" : "tag-moss"}">${escapeHtml(s)}</span>`).join("")}
                  </div></div>
                ` : ""}
                <button class="btn btn-primary mt-16 career-start-roadmap" data-goal-id="${g.id}" data-title="${escapeHtml(g.title)}">Start learning roadmap</button>
              </div>
            `).join("")}
          </div>
        </div>
      `);

      qs("#career-toggle-form").addEventListener("click", () => { showForm = !showForm; error = null; renderPage(); });
      const emptyCta = qs("#career-empty-cta");
      if (emptyCta) emptyCta.addEventListener("click", () => { showForm = true; renderPage(); });

      const submitBtn = qs("#career-submit");
      if (submitBtn) submitBtn.addEventListener("click", async () => {
        submitting = true; error = null; renderPage();
        const res = await Api.assessCareer({
          interests: qs("#ca-interests").value, skills: qs("#ca-skills").value, education: qs("#ca-education").value,
          experience: qs("#ca-experience").value, preferredWorkType: qs("#ca-worktype").value, careerGoals: qs("#ca-goals").value,
        });
        submitting = false;
        if (!res.ok) { error = res.data?.error || "Something went wrong."; renderPage(); return; }
        goals.unshift(res.data.goal);
        showForm = false;
        renderPage();
      });

      qsa(".career-start-roadmap").forEach((btn) => btn.addEventListener("click", () => {
        Router.navigate(`/roadmap?careerGoalId=${btn.dataset.goalId}&title=${encodeURIComponent(btn.dataset.title)}`);
      }));
    }

    load();
  });
};

/* ---------------------------- Roadmaps ---------------------------- */

Views.roadmapList = function () {
  requireAuth((user) => {
    const query = Router.currentQuery();
    let showForm = !!query.careerGoalId;
    let roadmaps = [];
    let loading = true;
    let generating = false;
    let error = null;

    async function load() {
      const res = await Api.listRoadmaps();
      roadmaps = res.ok ? res.data.roadmaps : [];
      loading = false;
      if (!isActivePath("/roadmap")) return;
      renderPage();
    }

    function renderPage() {
      renderShell(user, "/roadmap", `
        <div class="page">
          <div class="page-head">
            <div><h1 class="page-title">Learning Roadmaps</h1><p class="page-sub">A staged plan from where you are to where you're going.</p></div>
            <button class="btn btn-primary" id="rm-toggle-form">${showForm ? "Cancel" : "Create roadmap"}</button>
          </div>

          <div id="rm-form-wrap" class="${showForm ? "" : "hidden"} mt-24">
            <div class="card">
              <div class="field"><label>Skill / topic</label><input type="text" id="rm-skill" value="${escapeHtml(query.title || "")}" placeholder="e.g. Frontend Development" /></div>
              <div class="grid-2">
                <div class="field"><label>Current level</label>
                  <select id="rm-current"><option value="">Select…</option><option>Beginner</option><option>Intermediate</option><option>Advanced</option></select>
                </div>
                <div class="field"><label>Desired level</label>
                  <select id="rm-desired"><option value="">Select…</option><option>Job-ready</option><option>Confident/independent</option><option>Expert</option></select>
                </div>
                <div class="field"><label>Available time</label><input type="text" id="rm-time" placeholder="e.g. 5 hrs/week" /></div>
                <div class="field"><label>Deadline</label><input type="date" id="rm-deadline" /></div>
              </div>
              ${error ? `<p class="form-error">${escapeHtml(error)}</p>` : ""}
              <button class="btn btn-primary mt-8" id="rm-generate" ${generating ? "disabled" : ""}>${generating ? "Building your roadmap…" : "Generate roadmap"}</button>
            </div>
          </div>

          <div class="mt-24">
            ${loading ? `<p class="loading-text">Loading…</p>` : roadmaps.length === 0 ? `
              <div class="card-empty"><p class="display">Turn your goal into a step-by-step learning plan.</p>
                <button class="btn btn-primary" id="rm-empty-cta">Create roadmap</button></div>
            ` : `<div class="list-grid">
              ${roadmaps.map((r) => `
                <a href="#/roadmap/${r.id}" class="list-link">
                  <p class="title">${escapeHtml(r.title)}</p>
                  <p class="desc">${escapeHtml(r.description || "")}</p>
                  <span class="status">${r.status}</span>
                </a>
              `).join("")}
            </div>`}
          </div>
        </div>
      `);

      qs("#rm-toggle-form").addEventListener("click", () => { showForm = !showForm; error = null; renderPage(); });
      const emptyCta = qs("#rm-empty-cta");
      if (emptyCta) emptyCta.addEventListener("click", () => { showForm = true; renderPage(); });

      qs("#rm-generate").addEventListener("click", async () => {
        const skill = qs("#rm-skill").value.trim();
        if (!skill) { qs("#rm-skill").focus(); return; }
        generating = true; error = null; renderPage();

        const res = await Api.createRoadmap({
          careerGoalId: query.careerGoalId || undefined, skill,
          currentLevel: qs("#rm-current").value, desiredLevel: qs("#rm-desired").value,
          availableTime: qs("#rm-time").value, deadline: qs("#rm-deadline").value,
        });
        generating = false;
        if (!res.ok) { error = res.data?.error || "Something went wrong."; renderPage(); return; }
        Router.navigate(`/roadmap/${res.data.roadmap.id}`);
      });
    }

    load();
  });
};

Views.roadmapDetail = function ({ id }) {
  requireAuth((user) => {
    let roadmap = null;
    let loading = true;
    let notFound = false;

    async function load() {
      const res = await Api.getRoadmap(id);
      const stillHere = () => window.location.hash === "#/roadmap/" + id;
      if (!res.ok) { notFound = true; loading = false; if (stillHere()) renderPage(); return; }
      roadmap = res.data.roadmap;
      loading = false;
      if (!stillHere()) return;
      renderPage();
    }

    function renderPage() {
      if (loading) { renderShell(user, "/roadmap", `<div class="page"><p class="loading-text">Loading…</p></div>`); return; }
      if (notFound) { renderShell(user, "/roadmap", `<div class="page"><p class="form-error">Roadmap not found.</p></div>`); return; }

      const items = roadmap.items || [];
      const progress = items.length ? Math.round((items.filter((i) => i.completed).length / items.length) * 100) : 0;
      const stages = [...new Set(items.map((i) => i.stage))];

      renderShell(user, "/roadmap", `
        <div class="page">
          <h1 class="page-title">${escapeHtml(roadmap.title)}</h1>
          ${roadmap.description ? `<p class="page-sub">${escapeHtml(roadmap.description)}</p>` : ""}
          <div class="mt-24">
            <div class="progress-track"><div class="progress-fill" style="width:${progress}%"></div></div>
            <p class="small muted mt-8">${progress}% complete — ${items.filter((i) => i.completed).length} of ${items.length} items</p>
          </div>
          ${stages.map((stage) => `
            <div class="stage-block">
              <p class="stage-title">${escapeHtml(stage)}</p>
              ${items.filter((i) => i.stage === stage).map((item) => `
                <button class="item-row ${item.completed ? "done" : ""}" data-item-id="${item.id}">
                  <span class="item-check">${item.completed ? "✓" : ""}</span>
                  <span class="item-title">${escapeHtml(item.title)}</span>
                </button>
              `).join("")}
            </div>
          `).join("")}
          <div class="flex-gap mt-32">
            <a href="#/cv" class="btn btn-secondary">Next: Review your CV</a>
          </div>
        </div>
      `);
      qsa(".item-row").forEach((btn) => btn.addEventListener("click", async () => {
        const item = roadmap.items.find((i) => i.id === btn.dataset.itemId);
        const nextCompleted = !item.completed;
        item.completed = nextCompleted; // optimistic
        renderPage();
        const res = await Api.toggleRoadmapItem(roadmap.id, item.id, nextCompleted);
        if (!res.ok) { item.completed = !nextCompleted; renderPage(); } // revert on failure
      }));
    }

    load();
  });
};

/* ---------------------------- Interview Prep ---------------------------- */

Views.interviewList = function () {
  requireAuth((user) => {
    let sessions = [];
    let loading = true;
    let showForm = false;
    let starting = false;
    let error = null;

    async function load() {
      const res = await Api.listInterviews();
      sessions = res.ok ? res.data.sessions : [];
      loading = false;
      if (!isActivePath("/interview")) return;
      renderPage();
    }

    function renderPage() {
      renderShell(user, "/interview", `
        <div class="page">
          <div class="page-head">
            <div><h1 class="page-title">Interview Prep</h1><p class="page-sub">Practice with mock interview questions tailored to the role you're targeting.</p></div>
            <button class="btn btn-primary" id="iv-toggle-form">${showForm ? "Cancel" : "New mock interview"}</button>
          </div>

          <div id="iv-form-wrap" class="${showForm ? "" : "hidden"} mt-24">
            <div class="card">
              <div class="field"><label>Role you're interviewing for</label><input type="text" id="iv-role" placeholder="e.g. Frontend Developer" /></div>
              <div class="grid-2">
                <div class="field"><label>Company (optional)</label><input type="text" id="iv-company" placeholder="e.g. Google" /></div>
                <div class="field"><label>Industry (optional)</label><input type="text" id="iv-industry" placeholder="e.g. Fintech" /></div>
                <div class="field"><label>Experience level</label>
                  <select id="iv-level"><option value="">Select…</option><option>Entry-level</option><option>Mid-level</option><option>Senior</option></select>
                </div>
                <div class="field"><label>Interview type</label>
                  <select id="iv-type"><option value="behavioral">Behavioral</option><option value="technical">Technical</option><option value="mixed">Mixed</option></select>
                </div>
              </div>
              ${error ? `<p class="form-error">${escapeHtml(error)}</p>` : ""}
              <button class="btn btn-primary mt-8" id="iv-start" ${starting ? "disabled" : ""}>${starting ? "Preparing questions…" : "Start mock interview"}</button>
            </div>
          </div>

          <div class="mt-24">
            ${loading ? `<p class="loading-text">Loading…</p>` : sessions.length === 0 ? `
              <div class="card-empty"><p class="display">Practice before it counts.</p>
                <button class="btn btn-primary" id="iv-empty-cta">Start mock interview</button></div>
            ` : `<div class="list-grid">
              ${sessions.map((s) => `
                <a href="#/interview/${s.id}" class="list-link">
                  <p class="title">${escapeHtml(s.role)}${s.company ? ` · ${escapeHtml(s.company)}` : ""}</p>
                  <p class="desc">${escapeHtml(s.interviewType)} interview${s.overallScore != null ? ` — scored ${s.overallScore}/100` : ""}</p>
                  <span class="status">${s.status}</span>
                </a>
              `).join("")}
            </div>`}
          </div>
        </div>
      `);

      qs("#iv-toggle-form").addEventListener("click", () => { showForm = !showForm; error = null; renderPage(); });
      const emptyCta = qs("#iv-empty-cta");
      if (emptyCta) emptyCta.addEventListener("click", () => { showForm = true; renderPage(); });

      qs("#iv-start").addEventListener("click", async () => {
        const role = qs("#iv-role").value.trim();
        if (!role) { qs("#iv-role").focus(); return; }
        const company = qs("#iv-company").value.trim() || undefined;
        const industry = qs("#iv-industry").value.trim() || undefined;
        const experienceLevel = qs("#iv-level").value || undefined;
        const interviewType = qs("#iv-type").value;

        starting = true; error = null; renderPage();

        const res = await Api.startInterview({ role, company, industry, experienceLevel, interviewType });
        starting = false;
        if (!res.ok) { error = res.data?.error || "Something went wrong."; renderPage(); return; }
        Router.navigate(`/interview/${res.data.session.id}`);
      });
    }

    load();
  });
};

Views.interviewDetail = function ({ id }) {
  requireAuth((user) => {
    let session = null;
    let loading = true;
    let notFound = false;
    let activeQuestionId = null;
    let submitting = false;
    let completing = false;
    let error = null;

    async function load() {
      const res = await Api.getInterview(id);
      const stillHere = () => window.location.hash === "#/interview/" + id;
      if (!res.ok) { notFound = true; loading = false; if (stillHere()) renderPage(); return; }
      session = res.data.session;
      loading = false;
      if (!stillHere()) return;
      const firstUnanswered = (session.questions || []).find((q) => !q.answer);
      activeQuestionId = firstUnanswered ? firstUnanswered.id : null;
      renderPage();
    }

    function renderPage() {
      if (loading) { renderShell(user, "/interview", `<div class="page"><p class="loading-text">Loading…</p></div>`); return; }
      if (notFound) { renderShell(user, "/interview", `<div class="page"><p class="form-error">Interview session not found.</p></div>`); return; }

      const questions = session.questions || [];
      const answeredCount = questions.filter((q) => q.answer).length;
      const isCompleted = session.status === "completed";

      renderShell(user, "/interview", `
        <div class="page">
          <h1 class="page-title">${escapeHtml(session.role)}${session.company ? ` · ${escapeHtml(session.company)}` : ""}</h1>
          <p class="page-sub">${escapeHtml(session.interviewType)} interview — ${answeredCount} of ${questions.length} answered</p>

          ${isCompleted ? `
            <div class="card mt-24">
              <p class="title">Overall score: ${session.overallScore}/100</p>
              <p class="desc mt-8">${escapeHtml(session.feedback || "")}</p>
            </div>
          ` : ""}

          <div class="mt-24">
            ${questions.map((q, i) => `
              <div class="card mt-16">
                <p class="title">Q${i + 1}. ${escapeHtml(q.question)}</p>
                ${q.answer ? `
                  <p class="desc mt-8"><strong>Your answer:</strong> ${escapeHtml(q.answer)}</p>
                  ${q.evaluation ? `<p class="desc mt-8"><strong>Feedback:</strong> ${escapeHtml(q.evaluation)}</p>` : ""}
                ` : activeQuestionId === q.id ? `
                  <textarea id="iv-answer-${q.id}" class="mt-8" rows="4" placeholder="Type your answer…"></textarea>
                  ${error ? `<p class="form-error">${escapeHtml(error)}</p>` : ""}
                  <button class="btn btn-primary mt-8" data-question-id="${q.id}" id="iv-submit-${q.id}" ${submitting ? "disabled" : ""}>${submitting ? "Evaluating…" : "Submit answer"}</button>
                ` : `
                  <button class="btn btn-secondary mt-8" data-answer-this="${q.id}">Answer this question</button>
                `}
              </div>
            `).join("")}
          </div>

          ${!isCompleted && answeredCount > 0 ? `
            <div class="mt-24">
              <button class="btn btn-primary" id="iv-complete" ${completing ? "disabled" : ""}>${completing ? "Finishing…" : "Finish & get overall score"}</button>
            </div>
          ` : ""}
          ${isCompleted ? `<div class="flex-gap mt-32"><a href="#/interview" class="btn btn-secondary">Back to interviews</a></div>` : ""}
        </div>
      `);

      qsa("[data-answer-this]").forEach((btn) => btn.addEventListener("click", () => {
        activeQuestionId = btn.dataset.answerThis;
        renderPage();
      }));

      const submitBtn = qs(`#iv-submit-${activeQuestionId}`);
      if (submitBtn) {
        submitBtn.addEventListener("click", async () => {
          const textarea = qs(`#iv-answer-${activeQuestionId}`);
          const answer = textarea.value.trim();
          if (!answer) { textarea.focus(); return; }
          submitting = true; error = null; renderPage();

          const res = await Api.answerInterviewQuestion(session.id, activeQuestionId, answer);
          submitting = false;
          if (!res.ok) { error = res.data?.error || "Something went wrong."; renderPage(); return; }

          const q = session.questions.find((q) => q.id === activeQuestionId);
          q.answer = answer;
          q.evaluation = res.data.evaluation;
          const nextUnanswered = session.questions.find((q) => !q.answer);
          activeQuestionId = nextUnanswered ? nextUnanswered.id : null;
          renderPage();
        });
      }

      const completeBtn = qs("#iv-complete");
      if (completeBtn) {
        completeBtn.addEventListener("click", async () => {
          completing = true; renderPage();
          const res = await Api.completeInterview(session.id);
          completing = false;
          if (!res.ok) { error = res.data?.error || "Something went wrong."; renderPage(); return; }
          session.status = "completed";
          session.overallScore = res.data.overallScore;
          session.feedback = res.data.feedback;
          renderPage();
        });
      }
    }

    load();
  });
};

/* ---------------------------- CV Review ---------------------------- */

Views.cv = function () {
  requireAuth((user) => {
    let cvs = [];
    let selectedCvId = null;
    let reviews = [];
    let loading = true;
    let uploading = false;
    let analyzing = false;
    let error = null;

    async function load() {
      const res = await Api.listCvs();
      cvs = res.ok ? res.data.cvs : [];
      loading = false;
      if (!isActivePath("/cv")) return;
      if (cvs[0]) await selectCv(cvs[0].id);
      else renderPage();
    }

    async function selectCv(id) {
      selectedCvId = id;
      const res = await Api.getCv(id);
      reviews = res.ok ? res.data.reviews : [];
      if (!isActivePath("/cv")) return;
      renderPage();
    }

    function renderPage() {
      const selected = cvs.find((c) => c.id === selectedCvId) || null;

      renderShell(user, "/cv", `
        <div class="page page-wide">
          <div class="page-head">
            <div><h1 class="page-title">CV Review</h1><p class="page-sub">Upload a PDF or DOCX — optionally against a job description.</p></div>
            <div>
              <input type="file" id="cv-file-input" accept=".pdf,.docx" class="hidden" />
              <button class="btn btn-primary" id="cv-upload-btn" ${uploading ? "disabled" : ""}>${uploading ? "Uploading…" : "Upload CV"}</button>
            </div>
          </div>

          ${error ? `<p class="form-error mt-16">${escapeHtml(error)}</p>` : ""}

          ${loading ? `<p class="loading-text mt-24">Loading…</p>` : cvs.length === 0 ? `
            <div class="card-empty mt-24"><p class="display">Upload your CV and let Orivon identify areas you can improve.</p>
              <button class="btn btn-primary" id="cv-empty-cta">Upload CV</button></div>
          ` : `
            <div class="two-col-cv mt-24">
              <div>
                ${cvs.map((c) => `<button class="cv-tab ${c.id === selectedCvId ? "active" : ""}" data-cv-id="${c.id}">${escapeHtml(c.fileName)}</button>`).join("")}
              </div>
              <div>
                <div class="card">
                  <p style="font-weight:500;">Analyze against a job (optional)</p>
                  <textarea id="cv-jd" rows="4" class="mt-8" placeholder="Paste a job description to get a match analysis…"></textarea>
                  <button class="btn btn-primary mt-12" id="cv-analyze" ${analyzing ? "disabled" : ""}>${analyzing ? "Analyzing…" : "Analyze CV"}</button>
                </div>
                <div id="cv-reviews">${selected ? renderReviews() : ""}</div>
              </div>
            </div>
          `}
        </div>
      `);

      const fileInput = qs("#cv-file-input");
      qs("#cv-upload-btn").addEventListener("click", () => fileInput.click());
      const emptyCta = qs("#cv-empty-cta");
      if (emptyCta) emptyCta.addEventListener("click", () => fileInput.click());

      fileInput.addEventListener("change", async () => {
        const file = fileInput.files[0];
        if (!file) return;
        uploading = true; error = null; renderPage();
        const res = await Api.uploadCv(file);
        uploading = false;
        if (!res.ok) { error = res.data?.error || "Upload failed."; renderPage(); return; }
        cvs.unshift(res.data.cv);
        await selectCv(res.data.cv.id);
      });

      qsa(".cv-tab").forEach((btn) => btn.addEventListener("click", () => selectCv(btn.dataset.cvId)));

      const analyzeBtn = qs("#cv-analyze");
      if (analyzeBtn) analyzeBtn.addEventListener("click", async () => {
        const jd = qs("#cv-jd").value.trim();
        analyzing = true; error = null; renderPage();
        const res = await Api.reviewCv(selectedCvId, jd || undefined);
        analyzing = false;
        if (!res.ok) { error = res.data?.error || "Something went wrong."; renderPage(); return; }
        reviews.unshift(res.data.review);
        renderPage();
      });
    }

    function renderReviews() {
      if (!reviews.length) return "";
      return reviews.map((r) => `
        <div class="card">
          ${r.matchScore !== null && r.matchScore !== undefined ? `<p class="eyebrow">Match analysis</p><p class="match-score mt-8">Overall match: ${r.matchScore}%</p>` : ""}
          ${r.rawAnalysis ? `<p class="small muted mt-8">${escapeHtml(r.rawAnalysis)}</p>` : ""}
          <div class="grid-2 mt-16">
            <div><p class="eyebrow" style="color:var(--moss);">Strong areas</p>
              <div class="mt-8">${r.strongAreas.map((s) => `<p class="small muted">• ${escapeHtml(s)}</p>`).join("")}</div></div>
            <div><p class="eyebrow" style="color:var(--danger);">Missing / weak areas</p>
              <div class="mt-8">${r.weakAreas.map((s) => `<p class="small muted">• ${escapeHtml(s)}</p>`).join("")}</div></div>
          </div>
          <div class="mt-16"><p class="eyebrow">Recommended changes</p>
            <div class="mt-8">${r.recommendations.map((s) => `<p class="small">• ${escapeHtml(s)}</p>`).join("")}</div>
            <a class="btn btn-primary btn-small mt-12" href="#/cv/${selectedCvId}/edit">Apply these changes to your CV →</a></div>
          <p class="small muted mt-16">${formatDate(r.createdAt)} · ${r.versionId ? "reviewed after your edits" : "reviewed original upload"}</p>
        </div>
      `).join("");
    }

    load();
  });
};

/* ---------------------------- CV Editor ---------------------------- */

// Line-by-line comparison, used to preview an AI edit before it is accepted.
// Returns null for very large inputs (the preview is skipped rather than freezing the page).
function diffLines(before, after) {
  const a = before.split("\n"), b = after.split("\n");
  const n = a.length, m = b.length;
  if (n * m > 1500000) return null;
  const lcs = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push({ type: "same", text: a[i] }); i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) { ops.push({ type: "del", text: a[i] }); i++; }
    else { ops.push({ type: "add", text: b[j] }); j++; }
  }
  while (i < n) ops.push({ type: "del", text: a[i++] });
  while (j < m) ops.push({ type: "add", text: b[j++] });
  return ops;
}

// Shows only the changed lines plus one line of context, collapsing the rest.
function renderDiff(before, after) {
  const ops = diffLines(before, after);
  if (!ops) return `<p class="small muted mt-12">This CV is too long to show a line-by-line comparison. The full edited version will be saved if you accept.</p>`;
  const show = ops.map(() => false);
  ops.forEach((op, idx) => {
    if (op.type === "same") return;
    for (let k = Math.max(0, idx - 1); k <= Math.min(ops.length - 1, idx + 1); k++) show[k] = true;
  });
  const rows = [];
  let hidden = 0;
  ops.forEach((op, idx) => {
    if (!show[idx]) { hidden++; return; }
    if (hidden) { rows.push(`<div class="diff-gap">… ${hidden} unchanged line${hidden === 1 ? "" : "s"}</div>`); hidden = 0; }
    const mark = op.type === "add" ? "+" : op.type === "del" ? "−" : "";
    rows.push(`<div class="diff-line ${op.type}"><span class="diff-mark">${mark}</span>${op.text ? escapeHtml(op.text) : "&nbsp;"}</div>`);
  });
  if (hidden) rows.push(`<div class="diff-gap">… ${hidden} unchanged line${hidden === 1 ? "" : "s"}</div>`);
  return `<div class="diff">${rows.join("")}</div>`;
}

const CV_PLACEHOLDER_RE = /\[[A-Za-z][^\]]{0,58}\]/g;

Views.cvEditor = function ({ id }) {
  requireAuth((user) => {
    let loading = true;
    let notFound = false;
    let cv = null;
    let current = null;      // the saved version currently being worked on
    let versions = [];       // newest first (the original upload is listed separately)
    let review = null;       // latest review, source of the suggested corrections
    let text = "";           // what is in the box right now (may be unsaved)
    let customText = "";
    let pending = null;      // an AI edit waiting to be accepted or discarded
    let busy = null;         // which action is running, if any
    let notice = null;       // { ok, text }

    const stillHere = () => window.location.hash.startsWith(`#/cv/${id}/edit`);
    const dirty = () => Boolean(current) && text !== current.content;
    const placeholderCount = () => (text.match(CV_PLACEHOLDER_RE) || []).length;

    function applyEditorData(data) {
      cv = data.cv;
      current = data.current;
      versions = data.versions;
      review = data.latestReview;
      text = current.content;
    }

    async function load() {
      const res = await Api.getCvEditor(id);
      if (!stillHere()) return;
      loading = false;
      if (!res.ok) { notFound = true; renderPage(); return; }
      applyEditorData(res.data);
      renderPage();
    }

    function renderPage() {
      if (loading) { renderShell(user, "/cv", `<div class="page"><p class="loading-text">Loading…</p></div>`); return; }
      if (notFound) { renderShell(user, "/cv", `<div class="page"><p class="form-error">CV not found.</p><a href="#/cv" class="btn btn-secondary mt-16">Back to CV review</a></div>`); return; }

      const locked = Boolean(busy) || Boolean(pending);
      const holes = placeholderCount();

      renderShell(user, "/cv", `
        <div class="page page-wide">
          <div class="page-head">
            <div><h1 class="page-title">Edit your CV</h1><p class="page-sub">${escapeHtml(cv.fileName)} — apply the suggested corrections, edit by hand, then download.</p></div>
            <div class="cv-actions">
              <a class="btn btn-secondary btn-small" href="#/cv">Back to review</a>
              <button class="btn btn-secondary btn-small" data-export="docx" ${busy ? "disabled" : ""}>Download Word</button>
              <button class="btn btn-secondary btn-small" data-export="pdf" ${busy ? "disabled" : ""}>Download PDF</button>
            </div>
          </div>

          ${notice ? `<p class="${notice.ok ? "notice-ok" : "form-error"} mt-16" id="cv-notice">${escapeHtml(notice.text)}</p>` : ""}
          ${pending ? renderPending() : ""}

          <div class="cv-editor-grid mt-24">
            <div>
              <div class="card">
                <p class="eyebrow">Suggested corrections</p>
                ${review ? `
                  ${review.rawAnalysis ? `<p class="small muted mt-8">${escapeHtml(review.rawAnalysis)}</p>` : ""}
                  <p class="small muted mt-8">From your review on ${escapeHtml(formatDate(review.createdAt))}.</p>
                  <button class="btn btn-primary btn-block mt-12" id="cv-apply-all" ${locked ? "disabled" : ""}>${busy === "all" ? "Working on your CV…" : "Let Orivon apply all suggestions"}</button>
                  <p class="small muted mt-8">You'll see exactly what changed before anything is saved. Your uploaded file itself isn't altered — corrected versions are saved separately and can be downloaded. Or apply them one at a time:</p>
                  <div class="mt-8">
                    ${review.recommendations.map((r, i) => `
                      <div class="rec-row">
                        <p class="small">${escapeHtml(r)}</p>
                        <button class="btn btn-secondary btn-small" data-rec="${i}" ${locked ? "disabled" : ""}>${busy === "rec:" + i ? "Working…" : "Apply"}</button>
                      </div>`).join("")}
                  </div>
                ` : `<p class="small muted mt-8">No review yet. <a href="#/cv">Run a review</a> to get suggested corrections, or type your own instruction below.</p>`}

                <div class="mt-16">
                  <label class="small">Or tell Orivon what to change</label>
                  <textarea id="cv-custom" rows="2" class="mt-8" placeholder="e.g. Make my summary shorter and more direct" ${locked ? "disabled" : ""}>${escapeHtml(customText)}</textarea>
                  <button class="btn btn-primary btn-small mt-8" id="cv-custom-go" ${locked ? "disabled" : ""}>${busy === "custom" ? "Working…" : "Apply my instruction"}</button>
                </div>

                <div class="mt-16">
                  <button class="btn btn-secondary btn-small" id="cv-rereview" ${locked ? "disabled" : ""}>${busy === "review" ? "Reviewing…" : "Review this version again"}</button>
                  <p class="small muted mt-8">Re-runs the review on your corrected CV to check the improvement and get fresh suggestions.</p>
                </div>
              </div>
            </div>

            <div>
              <div class="card">
                <div class="flex-between">
                  <p class="eyebrow">Your CV</p>
                  <p class="small ${dirty() ? "unsaved" : "muted"}" id="cv-status">${dirty() ? "Unsaved changes" : "Saved · " + escapeHtml(current.label)}</p>
                </div>
                ${pending ? `<p class="small muted mt-8">Accept or discard the change above to keep editing.</p>` : ""}
                <textarea id="cv-text" class="cv-textarea mt-8" spellcheck="true" ${locked ? "readonly" : ""}>${escapeHtml(text)}</textarea>
                <p class="small mt-8 ${holes ? "unsaved" : "hidden"}" id="cv-hint">${holes ? `Your CV has ${holes} [bracketed] spot${holes === 1 ? "" : "s"} to fill in before you send it.` : ""}</p>
                <div class="flex-between mt-8">
                  <span class="small muted" id="cv-count">${text.length.toLocaleString("en-US")} characters</span>
                  <button class="btn btn-primary btn-small" id="cv-save" ${dirty() && !locked ? "" : "disabled"}>${busy === "save" ? "Saving…" : "Save changes"}</button>
                </div>
                <p class="small muted mt-8">Downloads use simple formatting (your name, section headings, bullets) — not your original design.</p>
              </div>

              <div class="card">
                <p class="eyebrow">Version history</p>
                <div class="mt-8">
                  ${versions.map((v, idx) => `
                    <div class="version-row">
                      <div><p class="small">${escapeHtml(v.label)}</p><p class="small muted">${escapeHtml(formatDate(v.createdAt))}</p></div>
                      ${idx === 0 ? `<span class="small muted">Current</span>` : `<button class="btn btn-secondary btn-small" data-restore="${escapeHtml(v.id)}" ${locked ? "disabled" : ""}>Restore</button>`}
                    </div>`).join("")}
                  <div class="version-row">
                    <div><p class="small">Original upload</p><p class="small muted">${escapeHtml(cv.fileName)}</p></div>
                    ${versions.length === 0 ? `<span class="small muted">Current</span>` : `<button class="btn btn-secondary btn-small" data-restore="original" ${locked ? "disabled" : ""}>Restore</button>`}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      `);
      bind();
    }

    function renderPending() {
      const p = pending;
      const placeholders = (p.revisedText.match(CV_PLACEHOLDER_RE) || []).filter((x) => !p.baseText.includes(x));
      if (p.unchanged) {
        return `
          <div class="card mt-16 pending-card" id="cv-pending">
            <p class="eyebrow">No change needed</p>
            <p class="small muted mt-8">${escapeHtml(p.title)}</p>
            <p class="small mt-12">The AI didn't change anything for this one, so your CV may already cover it. Nothing to accept.</p>
            <button class="btn btn-secondary mt-16" id="cv-discard">Close</button>
          </div>`;
      }
      return `
        <div class="card mt-16 pending-card" id="cv-pending">
          <p class="eyebrow">Review this change</p>
          <p class="small muted mt-8">${escapeHtml(p.title)}</p>
          ${p.changes.length ? `<ul class="mt-12">${p.changes.map((c) => `<li class="small">${escapeHtml(c)}</li>`).join("")}</ul>` : ""}
          ${p.warnings.length || placeholders.length ? `
            <div class="warn-box mt-12">
              ${placeholders.length ? `<p class="small">This edit contains placeholders (${placeholders.map(escapeHtml).join(", ")}). Fill in the real details after you accept — don't send your CV with them.</p>` : ""}
              ${p.warnings.map((w) => `<p class="small">${escapeHtml(w)}</p>`).join("")}
            </div>` : ""}
          ${renderDiff(p.baseText, p.revisedText)}
          <div class="mt-16">
            <button class="btn btn-primary" id="cv-accept" ${busy ? "disabled" : ""}>${busy === "accept" ? "Saving…" : "Accept change"}</button>
            <button class="btn btn-secondary" id="cv-discard" ${busy ? "disabled" : ""}>Discard</button>
          </div>
        </div>`;
    }

    // Keeps the status line, counter, save button and placeholder hint current while typing,
    // without re-rendering the page (which would reset the cursor).
    function refreshTypingUi() {
      const status = qs("#cv-status");
      status.textContent = dirty() ? "Unsaved changes" : "Saved · " + current.label;
      status.className = "small " + (dirty() ? "unsaved" : "muted");
      qs("#cv-count").textContent = text.length.toLocaleString("en-US") + " characters";
      qs("#cv-save").disabled = !dirty() || Boolean(busy);
      const holes = placeholderCount();
      const hint = qs("#cv-hint");
      hint.className = "small mt-8 " + (holes ? "unsaved" : "hidden");
      hint.textContent = holes ? `Your CV has ${holes} [bracketed] spot${holes === 1 ? "" : "s"} to fill in before you send it.` : "";
    }

    async function persist(content, label) {
      const res = await Api.saveCvVersion(id, { content, label });
      if (!res.ok) return { ok: false, error: res.data?.error || "Couldn't save. Please try again." };
      if (res.data.version) {
        versions.unshift(res.data.version);
        current = { versionId: res.data.version.id, label: res.data.version.label, content, createdAt: res.data.version.createdAt };
      } else {
        current = { ...current, content }; // nothing new to store: identical to the current version
      }
      return { ok: true };
    }

    async function runSuggest(instruction, key, title) {
      if (busy || !instruction) return;
      busy = key; notice = null; pending = null; renderPage();
      const res = await Api.suggestCvEdit(id, { instruction, baseText: text });
      busy = null;
      if (!stillHere()) return;
      if (!res.ok) {
        notice = { ok: false, text: res.data?.error || "Something went wrong. Nothing was changed." };
        renderPage();
        return;
      }
      pending = { instruction, title: title || instruction, ...res.data };
      renderPage();
      const card = qs("#cv-pending");
      if (card && card.scrollIntoView) card.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    async function acceptPending() {
      if (!pending || busy) return;
      busy = "accept"; renderPage();
      const label = ("Applied: " + pending.title).slice(0, 120);
      const saved = await persist(pending.revisedText, label);
      busy = null;
      if (!saved.ok) { notice = { ok: false, text: saved.error }; renderPage(); return; }
      text = pending.revisedText;
      pending = null;
      notice = { ok: true, text: "Change applied and saved as a new version." };
      renderPage();
    }

    async function saveCurrent() {
      if (busy || !dirty()) return true;
      busy = "save"; notice = null; renderPage();
      const saved = await persist(text, "Manual edit");
      busy = null;
      notice = saved.ok ? { ok: true, text: "Saved." } : { ok: false, text: saved.error };
      renderPage();
      return saved.ok;
    }

    async function reload() {
      const res = await Api.getCvEditor(id);
      if (!stillHere()) return;
      if (res.ok) applyEditorData(res.data);
    }

    function bind() {
      qs("#cv-text").addEventListener("input", (e) => { text = e.target.value; refreshTypingUi(); });
      qs("#cv-custom").addEventListener("input", (e) => { customText = e.target.value; });
      qs("#cv-save").addEventListener("click", () => { saveCurrent(); });

      qsa("[data-rec]").forEach((btn) => btn.addEventListener("click", () => {
        const i = Number(btn.dataset.rec);
        runSuggest(review.recommendations[i], "rec:" + i);
      }));

      const applyAll = qs("#cv-apply-all");
      if (applyAll) applyAll.addEventListener("click", () => {
        const recs = review.recommendations;
        const instruction = ("Apply all of these suggested corrections:\n" + recs.map((r, i) => `${i + 1}) ${r}`).join("\n")).slice(0, 2000);
        runSuggest(instruction, "all", `Applying all ${recs.length} suggestion${recs.length === 1 ? "" : "s"}`);
      });

      qs("#cv-custom-go").addEventListener("click", () => {
        const instruction = customText.trim();
        if (instruction.length < 3) { notice = { ok: false, text: "Tell Orivon what you'd like changed first." }; renderPage(); return; }
        runSuggest(instruction, "custom");
      });

      const accept = qs("#cv-accept");
      if (accept) accept.addEventListener("click", acceptPending);
      const discard = qs("#cv-discard");
      if (discard) discard.addEventListener("click", () => { pending = null; notice = null; renderPage(); });

      qs("#cv-rereview").addEventListener("click", async () => {
        if (dirty()) { notice = { ok: false, text: "Save your changes first, so the review covers them." }; renderPage(); return; }
        busy = "review"; notice = null; renderPage();
        const res = await Api.reviewCv(id);
        busy = null;
        if (!stillHere()) return;
        if (res.ok) { review = res.data.review; notice = { ok: true, text: "Review updated for your latest version." }; }
        else notice = { ok: false, text: res.data?.error || "Something went wrong." };
        renderPage();
      });

      qsa("[data-restore]").forEach((btn) => btn.addEventListener("click", async () => {
        if (dirty() && !window.confirm("Discard your unsaved changes and restore this version?")) return;
        busy = "restore"; notice = null; renderPage();
        const res = await Api.restoreCvVersion(id, btn.dataset.restore);
        if (res.ok) await reload();
        busy = null;
        if (!stillHere()) return;
        notice = res.ok ? { ok: true, text: res.data.unchanged ? "That version is already the current one." : "Version restored." } : { ok: false, text: res.data?.error || "Couldn't restore that version." };
        renderPage();
      }));

      qsa("[data-export]").forEach((btn) => btn.addEventListener("click", async () => {
        if (dirty() && !(await saveCurrent())) return; // downloads use the saved version, so save first
        window.location.href = `/api/cv/${id}/export?format=${btn.dataset.export}`;
      }));
    }

    load();
  });
};

/* ---------------------------- Settings ---------------------------- */

/* ------------------------------ Payment ------------------------------ */

Views.payment = function () {
  requireAuth(async (user) => {
    const isPro = user.plan === "pro";
    const until = user.planExpiresAt ? formatDate(user.planExpiresAt) : null;
    // Plans (and their prices) come from the server, which is the only place prices are decided.
    const plansRes = await Api.getPaymentPlans();
    const availablePlans = plansRes.ok && Array.isArray(plansRes.data?.plans) ? plansRes.data.plans : [];
    const extraPlans = availablePlans.filter((p) => p.key !== "pro"); // e.g. the 1-day pass

    renderShell(user, "/payment", `
      <div class="page" style="max-width:520px;">
        <h1 class="page-title">${isPro ? "Your Pro plan" : "Upgrade to Pro"}</h1>
        <p class="page-sub">Full depth across every capability, billed in Naira.</p>

        <div class="card mt-24">
          <div class="flex-between">
            <p class="title">Orivon Pro</p>
            <p class="price-amount" style="font-size:22px;">₦5,000<span>/month</span></p>
          </div>
          <ul class="price-features mt-16">
            <li>Everything in Free, expanded</li>
            <li>Advanced CV &amp; interview analysis</li>
            <li>Scholarship discovery &amp; assistance</li>
            <li>Advanced research workspace</li>
            <li>Persistent AI context</li>
          </ul>
          ${isPro && until ? `<p class="small mt-16" style="color:var(--moss-deep);">You're on Pro until ${escapeHtml(until)}. Paying again adds 30 more days.</p>` : ""}
        </div>

        <div class="card mt-16">
          <p class="title">Pay securely with Paystack</p>
          <p class="desc mt-8">You'll be taken to Paystack's secure checkout to complete your payment. Orivon never sees or stores your card details. Each payment adds 30 days of Pro, and nothing renews automatically.</p>
          <p id="pay-error" class="form-error hidden mt-8"></p>
          <button class="btn btn-primary btn-block mt-16" id="pay-cta">${isPro ? "Add 30 more days — ₦5,000" : "Pay ₦5,000 with Paystack"}</button>
        </div>

        ${extraPlans.map((p) => `
        <div class="card mt-16">
          <div class="flex-between">
            <p class="title">${escapeHtml(p.label)}</p>
            <p class="price-amount" style="font-size:22px;">₦${p.priceNgn.toLocaleString("en-NG")}</p>
          </div>
          <p class="desc mt-8">${p.days} day${p.days === 1 ? "" : "s"} of Pro with every feature above. A one-off payment, with no commitment.</p>
          <button class="btn btn-secondary btn-block mt-16" data-plan-key="${escapeHtml(p.key)}">Pay ₦${p.priceNgn.toLocaleString("en-NG")} for ${p.days} day${p.days === 1 ? "" : "s"}</button>
        </div>`).join("")}
      </div>
    `);

    async function startPayment(planKey, btn) {
      const label = btn.textContent;
      const errEl = qs("#pay-error");
      errEl.classList.add("hidden");
      btn.disabled = true; btn.textContent = "Taking you to Paystack…";

      const res = await Api.initializePayment(planKey);
      if (!res.ok || !res.data?.authorizationUrl) {
        errEl.textContent = res.data?.error || "Something went wrong. Please try again.";
        errEl.classList.remove("hidden");
        btn.disabled = false; btn.textContent = label;
        return;
      }
      window.location.href = res.data.authorizationUrl;
    }

    qs("#pay-cta").addEventListener("click", () => startPayment("pro", qs("#pay-cta")));
    qsa("[data-plan-key]").forEach((btn) => btn.addEventListener("click", () => startPayment(btn.dataset.planKey, btn)));
  });
};

// Where Paystack sends people back to after checkout (the server has already
// confirmed the payment with Paystack before redirecting here).
Views.paymentResult = function () {
  Session.get().then(async (user) => {
    const status = Router.currentQuery().status;
    let current = user;
    if (user && status === "success") {
      const me = await Api.me();
      if (me.ok) { Session.set(me.data.user); current = me.data.user; }
    }

    const messages = {
      success: {
        title: "Payment received",
        body: current?.planExpiresAt ? `Orivon Pro is active until ${formatDate(current.planExpiresAt)}. Thank you!` : "Orivon Pro is now active. Thank you!",
        cta: ["#/dashboard", "Go to your dashboard"],
      },
      pending: {
        title: "Payment processing",
        body: "Paystack hasn't confirmed your payment yet. Pro will switch on automatically as soon as it does — you can safely close this page.",
        cta: ["#/dashboard", "Back to dashboard"],
      },
      failed: {
        title: "Payment didn't go through",
        body: "You haven't been charged for Pro. You can try again whenever you're ready.",
        cta: ["#/payment", "Try again"],
      },
    };
    const m = messages[status] || messages.failed;

    mount(`
      <div class="auth-shell">
        <a href="#/" class="auth-brand">Orivon</a>
        <div class="auth-card">
          <h1>${escapeHtml(m.title)}</h1>
          <p class="sub">${escapeHtml(m.body)}</p>
          <a href="${user ? m.cta[0] : "#/login"}" class="btn btn-primary btn-block mt-24">${user ? m.cta[1] : "Log in"}</a>
        </div>
      </div>
    `);
  });
};

/* ------------------------------ Settings ------------------------------ */

Views.settings = function () {
  requireAuth((user) => {
    let showDelete = false;
    let emailMsg = null;
    let pwMsg = null;
    let deleteMsg = null;
    let prefs = null;
    let usage = null;

    async function load() {
      const [res, usageRes] = await Promise.all([Api.getPreferences(), Api.getUsage()]);
      usage = usageRes.ok ? usageRes.data.usage : null;
      prefs = res.ok ? res.data.preferences : { theme: "system", notificationsEnabled: true, aiTone: "encouraging" };
      if (!isActivePath("/settings")) return;
      renderPage();
    }

    function renderPage() {
      renderShell(user, "/settings", `
        <div class="page page-narrow">
          <h1 class="page-title">Settings</h1>
          <p class="page-sub">Manage your account, preferences, and privacy.</p>

          <div class="card mt-24">
            <p class="display" style="font-size:18px;">Account</p>
            <div class="field mt-16"><label>Email</label><input type="email" id="set-email" value="${escapeHtml(user.email)}" /></div>
            <div class="field"><label>Current password</label><input type="password" id="set-email-pw" autocomplete="current-password" />
              <span class="hint">Required to confirm an email change.</span></div>
            ${emailMsg ? `<p class="small mt-8" style="color:${emailMsg.ok ? "var(--moss-deep)" : "var(--danger)"}">${escapeHtml(emailMsg.text)}</p>` : ""}
            <button class="btn btn-secondary mt-12" id="set-save-email">Update email</button>

            <div style="border-top:1px solid var(--line); margin-top:24px; padding-top:24px;">
              <div class="field"><label>Current password</label><input type="password" id="set-current-pw" autocomplete="current-password" /></div>
              <div class="field"><label>New password</label><input type="password" id="set-new-pw" autocomplete="new-password" minlength="8" />
                <span class="hint">At least 8 characters.</span></div>
              ${pwMsg ? `<p class="small mt-8" style="color:${pwMsg.ok ? "var(--moss-deep)" : "var(--danger)"}">${escapeHtml(pwMsg.text)}</p>` : ""}
              <button class="btn btn-secondary mt-8" id="set-save-pw">Change password</button>
            </div>

            <div style="border-top:1px solid var(--line); margin-top:24px; padding-top:24px;">
              <button class="btn btn-ghost" id="set-logout">Log out</button>
            </div>
          </div>

          <div class="card">
            <p class="display" style="font-size:18px;">Preferences</p>
            <div class="field mt-16"><label>Theme</label>
              <select id="set-theme">
                <option value="system" ${prefs.theme === "system" ? "selected" : ""}>Match system</option>
                <option value="light" ${prefs.theme === "light" ? "selected" : ""}>Light</option>
                <option value="dark" ${prefs.theme === "dark" ? "selected" : ""}>Dark</option>
              </select>
            </div>
            <div class="field"><label>AI tone</label>
              <select id="set-ai-tone">
                <option value="encouraging" ${prefs.aiTone === "encouraging" ? "selected" : ""}>Encouraging</option>
                <option value="direct" ${prefs.aiTone === "direct" ? "selected" : ""}>Direct</option>
                <option value="concise" ${prefs.aiTone === "concise" ? "selected" : ""}>Concise</option>
              </select>
            </div>
            <label class="check-row"><input type="checkbox" id="set-notifications" ${prefs.notificationsEnabled ? "checked" : ""} /> Enable notifications</label>
          </div>

          <div class="card">
            <p class="display" style="font-size:18px;">Privacy</p>
            <p class="small muted mt-8">Your CVs and other uploaded documents are stored securely on the server and are only ever accessible by you. Deleting your account permanently removes them.</p>
            <a href="#/cv" class="small mt-8" style="display:inline-block; color:var(--moss-deep); font-weight:500;">Manage uploaded CVs &rarr;</a>
          </div>

          ${usage ? `
          <div class="card">
            <p class="display" style="font-size:18px;">AI usage</p>
            <p class="small muted mt-8">Last 24 hours · ${usage.plan === "pro" ? "Pro" : "Free"} plan</p>
            <div class="progress-track mt-12"><div class="progress-fill" style="width:${usage.percentUsed}%;"></div></div>
            <p class="small mt-8">${usage.tokens24h.toLocaleString()} of ${usage.dailyTokenLimit.toLocaleString()} tokens used (${usage.percentUsed}%)</p>
            <p class="small muted mt-8">Usage frees up gradually as it passes 24 hours old. You can make up to ${usage.requestsPerMinuteLimit} AI requests per minute.</p>
          </div>` : ""}

          <div class="card">
            <p class="display" style="font-size:18px;">Subscription</p>
            <p class="small muted mt-8">${user.plan === "pro" ? `You're on the Pro plan${user.planExpiresAt ? ` until ${escapeHtml(formatDate(user.planExpiresAt))}` : ""}.` : "You're currently on the Free plan."}</p>
            <a href="#/payment" class="btn btn-secondary mt-12">${user.plan === "pro" ? "Add more time" : "Upgrade to Pro"}</a>
          </div>

          <div class="card" style="border-color: rgba(179,73,47,.3);">
            <p class="display" style="font-size:18px; color:var(--danger);">Delete account</p>
            <p class="small muted mt-8">This permanently deletes your account and everything in it — profile, goals, roadmaps, CVs, and conversations. This cannot be undone.</p>
            <div id="set-delete-area" class="mt-16"></div>
          </div>
        </div>
      `);

      qs("#set-save-email").addEventListener("click", async () => {
        const res = await Api.updateEmail({ email: qs("#set-email").value, currentPassword: qs("#set-email-pw").value });
        if (res.ok) {
          user.email = res.data.email;
          user.emailVerified = !res.data.reverified;
          Session.set(user);
          emailMsg = { ok: true, text: res.data.reverified ? "Email updated. Check your new inbox to verify it." : "Email updated." };
        } else {
          emailMsg = { ok: false, text: res.data?.error || "Something went wrong." };
        }
        renderPage();
        if (res.ok && res.data.reverified) Router.navigate("/verify-email-pending");
      });

      qs("#set-save-pw").addEventListener("click", async () => {
        const res = await Api.changePassword({ currentPassword: qs("#set-current-pw").value, newPassword: qs("#set-new-pw").value });
        pwMsg = res.ok ? { ok: true, text: "Password changed." } : { ok: false, text: res.data?.error || "Something went wrong." };
        renderPage();
      });

      qs("#set-theme").addEventListener("change", (e) => { applyTheme(e.target.value); Api.updatePreferences({ theme: e.target.value }); });
      qs("#set-ai-tone").addEventListener("change", (e) => Api.updatePreferences({ aiTone: e.target.value }));
      qs("#set-notifications").addEventListener("change", (e) => Api.updatePreferences({ notificationsEnabled: e.target.checked }));

      qs("#set-logout").addEventListener("click", async () => { await Api.logout(); Session.clear(); Router.navigate("/"); });

      renderDeleteArea();
    }

    function renderDeleteArea() {
      const area = qs("#set-delete-area");
      if (!showDelete) {
        area.innerHTML = `<button class="btn btn-secondary" id="set-show-delete" style="border-color:var(--danger);color:var(--danger);">Delete my account</button>`;
        qs("#set-show-delete").addEventListener("click", () => { showDelete = true; renderDeleteArea(); });
        return;
      }
      area.innerHTML = `
        <div class="field"><label>Confirm your password</label><input type="password" id="set-delete-pw" /></div>
        <div class="field"><label>Type "DELETE" to confirm</label><input type="text" id="set-delete-confirm" /></div>
        ${deleteMsg ? `<p class="form-error">${escapeHtml(deleteMsg)}</p>` : ""}
        <div class="flex-gap">
          <button class="btn btn-ghost" id="set-cancel-delete">Cancel</button>
          <button class="btn" id="set-confirm-delete" style="background:var(--danger); color:#fff;" disabled>Permanently delete account</button>
        </div>
      `;
      const confirmInput = qs("#set-delete-confirm");
      const pwInput = qs("#set-delete-pw");
      const deleteBtn = qs("#set-confirm-delete");
      const syncDisabled = () => { deleteBtn.disabled = confirmInput.value !== "DELETE" || !pwInput.value; };
      confirmInput.addEventListener("input", syncDisabled);
      pwInput.addEventListener("input", syncDisabled);
      qs("#set-cancel-delete").addEventListener("click", () => { showDelete = false; renderDeleteArea(); });
      deleteBtn.addEventListener("click", async () => {
        const res = await Api.deleteAccount({ password: pwInput.value });
        if (!res.ok) { deleteMsg = res.data?.error || "Something went wrong."; renderDeleteArea(); return; }
        Session.clear();
        Router.navigate("/");
      });
    }

    load();
  });
};

/* ---------------------------- Theme (dark mode) ---------------------------- */

function resolveTheme(theme) {
  if (theme === "dark" || theme === "light") return theme;
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = resolveTheme(theme);
  try { localStorage.setItem("orivon_theme", theme); } catch (e) {}
}

async function initTheme() {
  let cached = "system";
  try { cached = localStorage.getItem("orivon_theme") || "system"; } catch (e) {}
  applyTheme(cached);

  const res = await Api.getPreferences();
  if (res.ok && res.data.preferences.theme) applyTheme(res.data.preferences.theme);
}

/* ------------------------------ Terms of Service & Privacy ------------------------------ */

Views.terms = function () {
  mount(`
    <div class="legal-page">
      <a href="#/" class="auth-brand">Orivon</a>
      <div class="legal-content">
        <h1>Orivon Terms of Service &amp; Privacy Policy</h1>
        <p class="muted small">Effective Date: [Insert Date] · Last Updated: [Insert Date]</p>
        <p>Welcome to <strong>Orivon</strong>. These Terms of Service &amp; Privacy Policy ("Policy") explain the rules for using Orivon and how we collect, use, protect, and process your information.</p>
        <p>By creating an account or using Orivon, you agree to this Policy. If you do not agree, please do not use our Services.</p>

        <h2>1. About Orivon</h2>
        <p>Orivon is an AI-powered platform designed to help students, young professionals, founders, and other users with career development, education, professional growth, and technology.</p>
        <p>Our Services may include:</p>
        <ul>
          <li>AI career guidance</li><li>AI mentoring</li><li>CV and resume review</li>
          <li>Interview preparation</li><li>Learning roadmaps</li><li>Scholarship and research assistance</li>
          <li>Programming assistance</li><li>AI-powered software development</li>
          <li>Mentorship and educational resources</li><li>Other features introduced by Orivon</li>
        </ul>

        <h2>2. Your Account</h2>
        <p>You must provide accurate information when creating an account and keep your login credentials secure.</p>
        <p>You are responsible for activity carried out through your account.</p>
        <p>You must not use Orivon for illegal, fraudulent, abusive, harmful, or unauthorized activities.</p>

        <h2>3. AI Services</h2>
        <p>Orivon uses artificial intelligence to provide certain Services.</p>
        <p>AI-generated responses may occasionally be inaccurate, incomplete, or outdated. You should verify important information before relying on it.</p>
        <p>Orivon does not guarantee employment, admission, scholarships, funding, business success, interview success, or any other specific outcome.</p>
        <p>Our AI Services are not a substitute for professional legal, medical, financial, or other regulated professional advice.</p>

        <h2>4. User Content</h2>
        <p>You may provide CVs, resumes, documents, code, questions, conversations, and other content to Orivon.</p>
        <p>You retain ownership of your content. By submitting content, you give Orivon permission to process it as reasonably necessary to provide and improve the Services, subject to this Policy and applicable law.</p>
        <p>You are responsible for ensuring that you have the right to upload any content you submit.</p>

        <h2>5. Payments and Subscriptions</h2>
        <p>Some Orivon Services may require payment.</p>
        <p>Prices, billing periods, and applicable charges will be shown before purchase.</p>
        <p>Payments may be processed through third-party payment providers.</p>
        <p>Where automatic renewal applies, it will be disclosed before purchase. You may cancel future renewals using the available cancellation method.</p>
        <p>Refunds are subject to Orivon's refund policy and applicable law.</p>

        <h2>6. Intellectual Property</h2>
        <p>The Orivon name, logo, software, designs, interface, and other proprietary materials belong to Orivon or its licensors.</p>
        <p>You may not copy, reproduce, modify, reverse engineer, scrape, or commercially exploit Orivon's proprietary materials without permission, except where permitted by law.</p>

        <h2>7. Information We Collect</h2>
        <p>Depending on how you use Orivon, we may collect:</p>
        <ul>
          <li>Name, email address, phone number, and account information</li>
          <li>Education, career, skills, and professional information</li>
          <li>CVs, resumes, documents, and code</li>
          <li>AI conversations and prompts</li>
          <li>Payment and transaction information</li>
          <li>Device, browser, IP address, and technical information</li>
          <li>Other information you voluntarily provide</li>
        </ul>

        <h2>8. How We Use Your Information</h2>
        <p>We may use your information to:</p>
        <ul>
          <li>Create and manage your account</li><li>Provide AI and other Orivon Services</li>
          <li>Review CVs, documents, and other uploads</li><li>Provide career and educational guidance</li>
          <li>Process payments and subscriptions</li><li>Provide customer support</li>
          <li>Improve and secure Orivon</li><li>Prevent fraud and misuse</li>
          <li>Comply with legal obligations</li>
        </ul>

        <h2>9. AI and Third-Party Processing</h2>
        <p>Information submitted to AI features may be processed by Orivon and, where necessary, third-party AI providers that help us provide those Services.</p>
        <p>Orivon may also use third-party providers for hosting, databases, payments, analytics, authentication, communication, security, and other technical services.</p>
        <p>We take reasonable steps to ensure that service providers handle information appropriately.</p>
        <p>You should avoid submitting unnecessary sensitive or confidential information.</p>

        <h2>10. Sharing Your Information</h2>
        <p>We may share information with trusted service providers when necessary to operate Orivon and provide the Services.</p>
        <p>We may also disclose information when required by law or when reasonably necessary to protect Orivon, our users, or others.</p>
        <p><strong>We do not sell your personal information.</strong></p>

        <h2>11. Data Security</h2>
        <p>We use reasonable technical and organizational measures to protect your information against unauthorized access, loss, misuse, or disclosure.</p>
        <p>However, no online service can guarantee complete security.</p>

        <h2>12. Data Retention</h2>
        <p>We retain information for as long as reasonably necessary to provide our Services, comply with legal obligations, resolve disputes, prevent fraud, and maintain appropriate records.</p>
        <p>When information is no longer required, we may delete or anonymize it.</p>

        <h2>13. Your Privacy Rights</h2>
        <p>Depending on applicable law, you may have the right to:</p>
        <ul>
          <li>Access your personal information</li><li>Correct inaccurate information</li>
          <li>Request deletion of your information</li><li>Object to or restrict certain processing</li>
          <li>Withdraw consent where applicable</li><li>Make a privacy complaint</li>
        </ul>
        <p>To exercise your rights, contact us at <strong>privacy@orivon.com</strong>.</p>

        <h2>14. Cookies</h2>
        <p>Orivon may use cookies and similar technologies for authentication, security, preferences, analytics, and improving the Services.</p>
        <p>Where required by law, we will request consent for non-essential cookies.</p>

        <h2>15. Third-Party Links</h2>
        <p>Orivon may contain links or integrations with third-party websites and services.</p>
        <p>Those services have their own terms and privacy policies, and Orivon is not responsible for their independent practices.</p>

        <h2>16. Suspension and Termination</h2>
        <p>We may suspend or terminate an account that violates this Policy, creates security risks, engages in unlawful activity, or misuses the Services.</p>
        <p>You may stop using Orivon at any time.</p>

        <h2>17. Service Availability</h2>
        <p>We aim to keep Orivon available and reliable, but we cannot guarantee uninterrupted or error-free operation.</p>
        <p>Features may occasionally be changed, suspended, or discontinued.</p>

        <h2>18. Limitation of Liability</h2>
        <p>To the maximum extent permitted by applicable law, Orivon is not responsible for indirect or consequential losses resulting from your use of the Services.</p>
        <p>Nothing in this Policy excludes rights or liability that cannot legally be excluded.</p>

        <h2>19. Changes to This Policy</h2>
        <p>We may update these Terms of Service &amp; Privacy Policy from time to time.</p>
        <p>Updated versions will be published on Orivon with a revised "Last Updated" date.</p>

        <h2>20. Governing Law</h2>
        <p>This Policy is governed by the laws of the <strong>Federal Republic of Nigeria</strong>, subject to any mandatory rights provided by applicable law.</p>

        <h2>21. Contact Us</h2>
        <p><strong>Orivon</strong><br/>
        Legal Entity: [Insert Legal Company Name]<br/>
        Email: support@orivonmentor.com<br/>
        Privacy: privacy@orivonmentor.com<br/>
        Website: https://orivonmentor.com<br/>
        Address: [Insert Registered Address]</p>
        <p>Orivon processes personal information in accordance with applicable data-protection laws, including the <strong>Nigeria Data Protection Act 2023</strong>, where applicable.</p>
      </div>
    </div>
  `);
};

/* ---------------------------- Forgot Password ---------------------------- */

Views.forgotPassword = function () {
  redirectIfAuthed().then((redirected) => {
    if (redirected || !isActivePath("/forgot-password")) return;
    mount(`
      <div class="auth-shell">
        <a href="#/" class="auth-brand">Orivon</a>
        <div class="auth-card">
          <h1>Reset your password</h1>
          <p class="sub">Enter your account email and we'll send you a link to reset your password.</p>
          <form id="forgot-form" class="mt-24">
            <div class="field"><label>Email</label><input type="email" id="forgot-email" required autocomplete="email" /></div>
            <p id="forgot-note" class="small muted hidden mt-8"></p>
            <button type="submit" class="btn btn-primary btn-block mt-16" id="forgot-submit">Send reset link</button>
          </form>
        </div>
        <p class="auth-foot"><a href="#/login">Back to login</a></p>
      </div>
    `);

    qs("#forgot-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = qs("#forgot-submit");
      btn.disabled = true; btn.textContent = "Sending…";
      const email = qs("#forgot-email").value.trim();

      const res = await Api.forgotPassword({ email });
      const note = qs("#forgot-note");
      note.classList.remove("hidden");
      if (!res.ok) {
        note.textContent = res.data?.error || "Something went wrong. Try again.";
        btn.disabled = false; btn.textContent = "Send reset link";
        return;
      }
      note.textContent = "If an account with that email exists, we've sent a reset link. Check your inbox (and spam folder).";
      btn.textContent = "Sent";
    });
  });
};

Views.verifyEmailPending = function () {
  Session.get().then((user) => {
    if (!user) { Router.navigate("/login"); return; }
    if (user.emailVerified) { Router.navigate(user.onboardingCompleted ? "/dashboard" : "/onboarding"); return; }

    mount(`
      <div class="auth-shell">
        <a href="#/" class="auth-brand">Orivon</a>
        <div class="auth-card">
          <h1>Check your inbox</h1>
          <p class="sub">We sent a verification link to <strong>${escapeHtml(user.email)}</strong>. Click it to activate your account and continue.</p>
          <p id="verify-note" class="small muted hidden mt-16"></p>
          <button class="btn btn-primary btn-block mt-24" id="resend-btn">Resend verification email</button>
          <button class="btn btn-secondary btn-block mt-8" id="recheck-btn">I've verified — continue</button>
        </div>
        <p class="auth-foot"><a href="#" id="verify-logout">Log out and use a different account</a></p>
      </div>
    `);

    qs("#verify-logout").addEventListener("click", async (e) => {
      e.preventDefault();
      await Api.logout();
      Session.clear();
      Router.navigate("/login");
    });

    qs("#resend-btn").addEventListener("click", async () => {
      const btn = qs("#resend-btn");
      btn.disabled = true; btn.textContent = "Sending…";
      const res = await Api.resendVerification();
      const note = qs("#verify-note");
      note.classList.remove("hidden");
      note.textContent = res.ok ? "Verification email sent. Check your inbox (and spam folder)." : (res.data?.error || "Something went wrong.");
      btn.disabled = false; btn.textContent = "Resend verification email";
    });

    qs("#recheck-btn").addEventListener("click", async () => {
      const btn = qs("#recheck-btn");
      btn.disabled = true; btn.textContent = "Checking…";
      const res = await Api.me();
      btn.disabled = false; btn.textContent = "I've verified — continue";
      if (res.ok && res.data.user.emailVerified) {
        Session.set(res.data.user);
        Router.navigate(res.data.user.onboardingCompleted ? "/dashboard" : "/onboarding");
      } else {
        const note = qs("#verify-note");
        note.classList.remove("hidden");
        note.textContent = "Still not verified — click the link in your email first.";
      }
    });
  });
};

Views.verifyEmail = function () {
  Session.get().then(async (user) => {
    const token = Router.currentQuery().token;
    const content = (inner) => mount(`
      <div class="auth-shell">
        <a href="#/" class="auth-brand">Orivon</a>
        <div class="auth-card">${inner}</div>
      </div>
    `);

    if (!token) {
      content(`<h1>Missing verification token</h1><p class="sub">Use the link from your email, or <a href="#/verify-email-pending">request a new one</a>.</p>`);
      return;
    }

    content(`<h1>Verifying…</h1><p class="sub">One moment.</p>`);
    const res = await Api.verifyEmail({ token });

    if (!res.ok) {
      content(`<h1>Verification failed</h1><p class="sub">${escapeHtml(res.data?.error || "This link is invalid or expired.")}</p><a href="#/verify-email-pending" class="btn btn-primary btn-block mt-16">Request a new link</a>`);
      return;
    }

    if (user) {
      const meRes = await Api.me();
      if (meRes.ok) Session.set(meRes.data.user);
      content(`<h1>Email verified</h1><p class="sub">Redirecting…</p>`);
      const fresh = meRes.ok ? meRes.data.user : null;
      Router.navigate(fresh && !fresh.onboardingCompleted ? "/onboarding" : "/dashboard");
    } else {
      content(`<h1>Email verified</h1><p class="sub">You can now log in.</p><a href="#/login" class="btn btn-primary btn-block mt-16">Log in</a>`);
    }
  });
};

Views.resetPassword = function () {
  redirectIfAuthed().then((redirected) => {
    if (redirected || !isActivePath("/reset-password")) return;
    const token = Router.currentQuery().token;

    mount(`
      <div class="auth-shell">
        <a href="#/" class="auth-brand">Orivon</a>
        <div class="auth-card">
          <h1>Choose a new password</h1>
          <p class="sub">${token ? "Enter a new password for your account." : "This reset link is missing its token — use the link from your email, or request a new one."}</p>
          ${token ? `
            <form id="reset-form" class="mt-24">
              <div class="field"><label>New password</label><input type="password" id="reset-password" required minlength="8" autocomplete="new-password" />
                <span class="hint">At least 8 characters.</span></div>
              <div class="field"><label>Confirm new password</label><input type="password" id="reset-confirm" required autocomplete="new-password" /></div>
              <p id="reset-error" class="form-error hidden"></p>
              <p id="reset-success" class="small hidden mt-8">Your password has been reset. <a href="#/login">Log in</a>.</p>
              <button type="submit" class="btn btn-primary btn-block mt-16" id="reset-submit">Reset password</button>
            </form>
          ` : `<a href="#/forgot-password" class="btn btn-secondary btn-block mt-24">Request a new link</a>`}
        </div>
        <p class="auth-foot"><a href="#/login">Back to login</a></p>
      </div>
    `);

    if (!token) return;

    qs("#reset-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const newPassword = qs("#reset-password").value;
      const confirm = qs("#reset-confirm").value;
      const errEl = qs("#reset-error");
      const showError = (msg) => { errEl.textContent = msg; errEl.classList.remove("hidden"); };

      if (newPassword.length < 8) return showError("Password must be at least 8 characters.");
      if (newPassword !== confirm) return showError("Passwords don't match.");

      const btn = qs("#reset-submit");
      btn.disabled = true; btn.textContent = "Resetting…";
      const res = await Api.resetPassword({ token, newPassword });
      if (!res.ok) {
        showError(res.data?.error || "Something went wrong.");
        btn.disabled = false; btn.textContent = "Reset password";
        return;
      }
      qs("#reset-form").classList.add("hidden");
      qs("#reset-success").classList.remove("hidden");
    });
  });
};

/* ---------------------------- Route registration & boot ---------------------------- */

Router.add("/", Views.landing);
Router.add("/login", Views.login);
Router.add("/register", Views.register);
Router.add("/onboarding", Views.onboarding);
Router.add("/dashboard", Views.dashboard);
Router.add("/chat", Views.chat);
Router.add("/career", Views.career);
Router.add("/roadmap", Views.roadmapList);
Router.add("/roadmap/:id", Views.roadmapDetail);
Router.add("/interview", Views.interviewList);
Router.add("/interview/:id", Views.interviewDetail);
Router.add("/cv", Views.cv);
Router.add("/goals", Views.goals);
Router.add("/activity", Views.activity);
Router.add("/settings", Views.settings);
Router.add("/cv/:id/edit", Views.cvEditor);
Router.add("/payment", Views.payment);
Router.add("/payment-result", Views.paymentResult);
Router.add("/terms", Views.terms);
Router.add("/forgot-password", Views.forgotPassword);
Router.add("/reset-password", Views.resetPassword);
Router.add("/verify-email-pending", Views.verifyEmailPending);
Router.add("/verify-email", Views.verifyEmail);

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => { initTheme(); Router.init(); });
} else {
  initTheme();
  Router.init();
}

/* ------------------------------ Research Assistant ------------------------------ */

Views.researchList = function () {
  requireAuth((user) => {
    let projects = [];
    let loading = true;
    let showForm = false;
    let creating = false;
    let error = null;

    async function load() {
      const res = await Api.listResearchProjects();
      projects = res.ok ? res.data.projects : [];
      loading = false;
      if (!isActivePath("/research")) return;
      renderPage();
    }

    function renderPage() {
      renderShell(user, "/research", `
        <div class="page">
          <div class="page-head">
            <div><h1 class="page-title">Research Assistant</h1><p class="page-sub">Upload sources, ask questions, and keep your notes organized in one place.</p></div>
            <button class="btn btn-primary" id="rs-toggle-form">${showForm ? "Cancel" : "New project"}</button>
          </div>

          <div id="rs-form-wrap" class="${showForm ? "" : "hidden"} mt-24">
            <div class="card">
              <div class="field"><label>Project title</label><input type="text" id="rs-title" placeholder="e.g. Renewable energy adoption in West Africa" /></div>
              <div class="field mt-8"><label>Research question (optional)</label><input type="text" id="rs-question" placeholder="What are the key barriers to adoption?" /></div>
              ${error ? `<p class="form-error">${escapeHtml(error)}</p>` : ""}
              <button class="btn btn-primary mt-8" id="rs-create" ${creating ? "disabled" : ""}>${creating ? "Creating…" : "Create project"}</button>
            </div>
          </div>

          <div class="mt-24">
            ${loading ? `<p class="loading-text">Loading…</p>` : projects.length === 0 ? `
              <div class="card-empty"><p class="display">Start your first research project.</p>
                <button class="btn btn-primary" id="rs-empty-cta">New project</button></div>
            ` : `<div class="list-grid">
              ${projects.map((p) => `
                <a href="#/research/${p.id}" class="list-link">
                  <p class="title">${escapeHtml(p.title)}</p>
                  <p class="desc">${escapeHtml(p.researchQuestion || "No research question set")}</p>
                  <span class="status">${p.status}</span>
                </a>
              `).join("")}
            </div>`}
          </div>
        </div>
      `);

      qs("#rs-toggle-form").addEventListener("click", () => { showForm = !showForm; error = null; renderPage(); });
      const emptyCta = qs("#rs-empty-cta");
      if (emptyCta) emptyCta.addEventListener("click", () => { showForm = true; renderPage(); });

      qs("#rs-create").addEventListener("click", async () => {
        const title = qs("#rs-title").value.trim();
        if (!title) { qs("#rs-title").focus(); return; }
        creating = true; error = null; renderPage();

        const res = await Api.createResearchProject({ title, researchQuestion: qs("#rs-question").value.trim() || undefined });
        creating = false;
        if (!res.ok) { error = res.data?.error || "Something went wrong."; renderPage(); return; }
        Router.navigate(`/research/${res.data.project.id}`);
      });
    }

    load();
  });
};

Views.researchDetail = function ({ id }) {
  requireAuth((user) => {
    let project = null;
    let documents = [];
    let notes = [];
    let loading = true;
    let notFound = false;
    let uploading = false;
    let asking = false;
    let error = null;
    let lastAnswer = null;

    async function load() {
      const res = await Api.getResearchProject(id);
      const stillHere = () => window.location.hash === "#/research/" + id;
      if (!res.ok) { notFound = true; loading = false; if (stillHere()) renderPage(); return; }
      project = res.data.project;
      documents = res.data.documents;
      notes = res.data.notes;
      loading = false;
      if (!stillHere()) return;
      renderPage();
    }

    function renderPage() {
      if (loading) { renderShell(user, "/research", `<div class="page"><p class="loading-text">Loading…</p></div>`); return; }
      if (notFound) { renderShell(user, "/research", `<div class="page"><p class="form-error">Research project not found.</p></div>`); return; }

      renderShell(user, "/research", `
        <div class="page">
          <div class="flex-between">
            <div><h1 class="page-title">${escapeHtml(project.title)}</h1><p class="page-sub">${escapeHtml(project.researchQuestion || "No research question set")}</p></div>
            <div style="display:flex; gap:8px;">
              <a class="btn btn-secondary btn-small" href="/api/research/${project.id}/export?format=pdf" download>Export PDF</a>
              <a class="btn btn-secondary btn-small" href="/api/research/${project.id}/export?format=docx" download>Export Word</a>
            </div>
          </div>

          <div class="card mt-24">
            <div class="flex-between"><p class="title">Sources</p>
              <label class="btn btn-secondary btn-small" style="cursor:pointer;">${uploading ? "Uploading…" : "Upload document"}<input type="file" id="rs-file-input" accept=".pdf,.docx" style="display:none;" ${uploading ? "disabled" : ""} /></label>
            </div>
            ${documents.length === 0 ? `<p class="desc mt-8">No documents yet. Upload a PDF or DOCX and I'll read it to answer your questions.</p>` : `
              <div class="mt-16">
                ${documents.map((d) => `
                  <div class="flex-between mt-8">
                    <p class="desc">${escapeHtml(d.fileName)}</p>
                    <button class="btn btn-secondary btn-small" data-del-doc="${d.id}">Remove</button>
                  </div>
                `).join("")}
              </div>
            `}
            ${error ? `<p class="form-error mt-8">${escapeHtml(error)}</p>` : ""}
          </div>

          <div class="card mt-24">
            <p class="title">Ask a research question</p>
            <p class="desc mt-8">${documents.length > 0 ? "I'll draw on your uploaded documents where relevant, plus general knowledge." : "No documents uploaded — I'll answer from general knowledge. Upload sources above for grounded answers."}</p>
            <textarea id="rs-question-input" class="mt-16" rows="3" placeholder="e.g. What are the main counterarguments to this thesis?"></textarea>
            <button class="btn btn-primary mt-8" id="rs-ask" ${asking ? "disabled" : ""}>${asking ? "Thinking…" : "Ask"}</button>
            ${lastAnswer ? `
              <div class="mt-16">
                <p class="desc"><strong>Answer:</strong> ${escapeHtml(lastAnswer.answer)}</p>
                ${lastAnswer.suggestedNextSteps?.length ? `<p class="desc mt-8"><strong>Next steps:</strong></p><ul>${lastAnswer.suggestedNextSteps.map((s) => `<li class="desc">${escapeHtml(s)}</li>`).join("")}</ul>` : ""}
                <p class="badge mt-8">${lastAnswer.usedDocuments ? "Grounded in your documents" : "From general knowledge"}</p>
              </div>
            ` : ""}
          </div>

          <div class="card mt-24">
            <p class="title">Notes</p>
            <textarea id="rs-note-input" class="mt-16" rows="2" placeholder="Add a note…"></textarea>
            <button class="btn btn-secondary btn-small mt-8" id="rs-add-note">Add note</button>
            <div class="mt-16">
              ${notes.length === 0 ? `<p class="desc">No notes yet.</p>` : notes.map((n) => `
                <div class="flex-between mt-8">
                  <p class="desc" style="white-space:pre-wrap;">${escapeHtml(n.content)}</p>
                  <div style="display:flex; gap:6px; flex-shrink:0;">
                    <a class="btn btn-secondary btn-small" href="/api/research/${project.id}/notes/${n.id}/export?format=pdf" download title="Export as PDF">PDF</a>
                    <a class="btn btn-secondary btn-small" href="/api/research/${project.id}/notes/${n.id}/export?format=docx" download title="Export as Word">Word</a>
                    <button class="btn btn-secondary btn-small" data-del-note="${n.id}">Remove</button>
                  </div>
                </div>
              `).join("")}
            </div>
          </div>
        </div>
      `);

      qs("#rs-file-input").addEventListener("change", async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        uploading = true; error = null; renderPage();
        const res = await Api.uploadResearchDocument(project.id, file);
        uploading = false;
        if (!res.ok) { error = res.data?.error || "Upload failed."; renderPage(); return; }
        documents.unshift(res.data.document);
        renderPage();
      });

      qsa("[data-del-doc]").forEach((btn) => btn.addEventListener("click", async () => {
        const res = await Api.deleteResearchDocument(project.id, btn.dataset.delDoc);
        if (res.ok) { documents = documents.filter((d) => d.id !== btn.dataset.delDoc); renderPage(); }
      }));

      qs("#rs-ask").addEventListener("click", async () => {
        const question = qs("#rs-question-input").value.trim();
        if (!question) return;
        asking = true; error = null; renderPage();
        const res = await Api.askResearchQuestion(project.id, question);
        asking = false;
        if (!res.ok) { error = res.data?.error || "Something went wrong."; renderPage(); return; }
        lastAnswer = res.data;
        notes.unshift(res.data.note);
        renderPage();
      });

      qs("#rs-add-note").addEventListener("click", async () => {
        const content = qs("#rs-note-input").value.trim();
        if (!content) return;
        const res = await Api.addResearchNote(project.id, { content });
        if (res.ok) { notes.unshift(res.data.note); renderPage(); }
      });

      qsa("[data-del-note]").forEach((btn) => btn.addEventListener("click", async () => {
        const res = await Api.deleteResearchNote(project.id, btn.dataset.delNote);
        if (res.ok) { notes = notes.filter((n) => n.id !== btn.dataset.delNote); renderPage(); }
      }));
    }

    load();
  });
};

/* ------------------------------ Scholarships ------------------------------ */

Views.scholarships = function () {
  requireAuth((user) => {
    let profile = null;
    let scholarships = [];
    let applications = [];
    let loading = true;
    let discovering = false;
    let showProfileForm = false;
    let error = null;
    let note = null;

    async function load() {
      const [profileRes, scholarshipsRes, appsRes] = await Promise.all([
        Api.getScholarshipProfile(), Api.listScholarships(), Api.listScholarshipApplications(),
      ]);
      profile = profileRes.ok ? profileRes.data.profile : null;
      scholarships = scholarshipsRes.ok ? scholarshipsRes.data.scholarships : [];
      applications = appsRes.ok ? appsRes.data.applications : [];
      loading = false;
      showProfileForm = !profile;
      if (!isActivePath("/scholarships")) return;
      renderPage();
    }

    function appFor(scholarshipId) {
      return applications.find((a) => a.scholarshipId === scholarshipId);
    }

    function renderPage() {
      renderShell(user, "/scholarships", `
        <div class="page">
          <div class="page-head">
            <div><h1 class="page-title">Scholarships</h1><p class="page-sub">Real, well-known funding programs matched to your profile — always suggested, never guaranteed.</p></div>
          </div>

          <div class="card mt-24">
            <div class="flex-between">
              <p class="title">Your scholarship profile</p>
              <button class="btn btn-secondary btn-small" id="sch-edit-profile">${profile ? "Edit" : "Set up"}</button>
            </div>
            ${profile && !showProfileForm ? `
              <p class="desc mt-8">${escapeHtml(profile.educationLevel || "—")} · ${escapeHtml(profile.field || "—")} · targeting ${escapeHtml(profile.targetDegree || "—")}</p>
            ` : ""}
            <div id="sch-profile-form" class="${showProfileForm ? "" : "hidden"} mt-16">
              <div class="grid-2">
                <div class="field"><label>Education level</label><input id="sch-edu" type="text" value="${escapeHtml(profile?.educationLevel || "")}" placeholder="e.g. Bachelor's degree" /></div>
                <div class="field"><label>Field of study</label><input id="sch-field" type="text" value="${escapeHtml(profile?.field || "")}" placeholder="e.g. Computer Science" /></div>
                <div class="field"><label>Current country</label><input id="sch-country" type="text" value="${escapeHtml(profile?.country || "")}" placeholder="e.g. Nigeria" /></div>
                <div class="field"><label>Nationality</label><input id="sch-nat" type="text" value="${escapeHtml(profile?.nationality || "")}" placeholder="e.g. Nigerian" /></div>
                <div class="field"><label>Target degree</label><input id="sch-degree" type="text" value="${escapeHtml(profile?.targetDegree || "")}" placeholder="e.g. Master's in Data Science" /></div>
                <div class="field"><label>Funding needs</label><input id="sch-funding" type="text" value="${escapeHtml(profile?.fundingNeeds || "")}" placeholder="e.g. Full tuition + living costs" /></div>
              </div>
              ${error ? `<p class="form-error">${escapeHtml(error)}</p>` : ""}
              <button class="btn btn-primary mt-8" id="sch-save-profile">Save profile</button>
            </div>
          </div>

          <div class="flex-between mt-24">
            <p class="title">Suggested programs</p>
            <button class="btn btn-primary" id="sch-discover" ${discovering ? "disabled" : ""}>${discovering ? "Searching…" : "Find scholarships for me"}</button>
          </div>
          ${note ? `<p class="desc mt-8">${escapeHtml(note)}</p>` : ""}

          <div class="mt-16">
            ${loading ? `<p class="loading-text">Loading…</p>` : scholarships.length === 0 ? `
              <div class="card-empty"><p class="display">No suggestions yet.</p><p class="desc">Fill out your profile, then click "Find scholarships for me."</p></div>
            ` : `<div class="list-grid">
              ${scholarships.map((s) => {
                const app = appFor(s.id);
                return `
                <div class="card">
                  <p class="title">${escapeHtml(s.name)}</p>
                  <p class="desc mt-8">${escapeHtml(s.provider)}${s.destination ? ` · ${escapeHtml(s.destination)}` : ""}</p>
                  ${s.eligibility ? `<p class="desc mt-8"><strong>Eligibility:</strong> ${escapeHtml(s.eligibility)}</p>` : ""}
                  ${s.funding ? `<p class="desc mt-8"><strong>Funding:</strong> ${escapeHtml(s.funding)}</p>` : ""}
                  ${s.deadline ? `<p class="desc mt-8"><strong>Deadline:</strong> ${escapeHtml(s.deadline)}</p>` : ""}
                  <p class="badge mt-8">${s.verified ? "Verified" : "AI-suggested — verify on official site"}</p>
                  <div class="mt-16">
                    ${app ? `<span class="status">Tracking: ${escapeHtml(app.status)}</span>` : `<button class="btn btn-secondary btn-small" data-track="${s.id}">Track application</button>`}
                  </div>
                </div>
              `; }).join("")}
            </div>`}
          </div>

          ${applications.length > 0 ? `
            <div class="mt-32">
              <p class="title">Your applications</p>
              <div class="list-grid mt-16">
                ${applications.map((a) => `
                  <div class="card">
                    <p class="title">${escapeHtml(a.scholarship?.name || "Scholarship")}</p>
                    <div class="field mt-8"><label>Status</label>
                      <select data-app-id="${a.id}" class="sch-status-select">
                        ${["not-started", "in-progress", "submitted", "accepted", "rejected"].map((s) => `<option value="${s}" ${a.status === s ? "selected" : ""}>${s}</option>`).join("")}
                      </select>
                    </div>
                  </div>
                `).join("")}
              </div>
            </div>
          ` : ""}
        </div>
      `);

      qs("#sch-edit-profile").addEventListener("click", () => { showProfileForm = !showProfileForm; renderPage(); });

      const saveBtn = qs("#sch-save-profile");
      if (saveBtn) saveBtn.addEventListener("click", async () => {
        error = null;
        const body = {
          educationLevel: qs("#sch-edu").value.trim(), field: qs("#sch-field").value.trim(),
          country: qs("#sch-country").value.trim(), nationality: qs("#sch-nat").value.trim(),
          targetDegree: qs("#sch-degree").value.trim(), fundingNeeds: qs("#sch-funding").value.trim(),
        };
        const res = await Api.saveScholarshipProfile(body);
        if (!res.ok) { error = res.data?.error || "Something went wrong."; renderPage(); return; }
        profile = res.data.profile;
        showProfileForm = false;
        renderPage();
      });

      qs("#sch-discover").addEventListener("click", async () => {
        if (!profile) { showProfileForm = true; renderPage(); return; }
        discovering = true; error = null; note = null; renderPage();
        const res = await Api.discoverScholarships();
        discovering = false;
        if (!res.ok) { error = res.data?.error || "Something went wrong."; renderPage(); return; }
        note = res.data.note;
        const existingIds = new Set(scholarships.map((s) => s.id));
        for (const s of res.data.scholarships) if (!existingIds.has(s.id)) scholarships.unshift(s);
        renderPage();
      });

      qsa("[data-track]").forEach((btn) => btn.addEventListener("click", async () => {
        const res = await Api.startScholarshipApplication(btn.dataset.track);
        if (res.ok) { applications.unshift(res.data.application); renderPage(); }
      }));

      qsa(".sch-status-select").forEach((sel) => sel.addEventListener("change", async () => {
        const res = await Api.updateScholarshipApplication(sel.dataset.appId, { status: sel.value });
        if (res.ok) {
          const app = applications.find((a) => a.id === sel.dataset.appId);
          if (app) app.status = sel.value;
        }
      }));
    }

    load();
  });
};

/* Expose for debugging/testing. */
window.Api = Api;
window.Session = Session;
window.Router = Router;
Router.add("/scholarships", Views.scholarships);
Router.add("/research", Views.researchList);
Router.add("/research/:id", Views.researchDetail);
