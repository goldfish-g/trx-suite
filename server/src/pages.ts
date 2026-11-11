// The page Steam sends the player back to. It may open in a popup, a tab, or
// another browser altogether, so it only says how things went and nudges the
// app; the app collects the result itself by polling.

export interface AuthPageOptions {
    ok: boolean;
    title: string;
    message: string;
    /** The sign-in's state, to tell the app which sign-in finished. */
    state?: string;
    /** The app's address: where the link goes and the only origin told about it. */
    appUrl: string;
}

function escapeHtml(text: string): string {
    return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/** JSON that stays inert inside a <script> element. */
function scriptJson(value: unknown): string {
    return JSON.stringify(value).replace(/</g, '\\u003c');
}

const STYLE = `
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;min-height:100dvh;display:grid;place-items:center;padding:16px;
  background:#0d0a06 radial-gradient(ellipse at 50% 0%,#2b2214 0%,#120e08 55%,#0b0805 100%);
  color:#e8dcc0;font:17px/1.55 Georgia,'Palatino Linotype','Book Antiqua',serif}
main{width:100%;max-width:28rem;padding:2.25rem 1.75rem 2rem;text-align:center;
  background:linear-gradient(#1a140c,#130f09);border:1px solid #8a6d32;
  outline:1px solid #3d311a;outline-offset:5px;box-shadow:0 18px 60px #000c,inset 0 0 40px #0008}
.seal{width:3.25rem;height:3.25rem;margin:0 auto 1rem;display:grid;place-items:center;transform:rotate(45deg);
  border:2px solid #c9a24a;color:#f0cf7a;font-size:1.4rem;box-shadow:0 0 18px #c9a24a44}
.seal span{transform:rotate(-45deg)}
.err .seal{border-color:#b5653f;color:#e59a72;box-shadow:0 0 18px #b5653f44}
h1{margin:0 0 .5rem;font-weight:normal;font-size:1.3rem;letter-spacing:.16em;text-transform:uppercase;color:#d9b45f}
.err h1{color:#e59a72}
.rule{height:1px;margin:1rem auto 1.1rem;width:70%;background:linear-gradient(90deg,transparent,#b8913f,transparent)}
p{margin:.55rem 0;color:#d6c9aa}
.hint{font-size:.9rem;color:#9d916f}
a{display:inline-block;margin-top:1.1rem;padding:.6rem 1.3rem;border:1px solid #c9a24a;color:#f0cf7a;
  text-decoration:none;letter-spacing:.08em;text-transform:uppercase;font-size:.85rem}
a:hover,a:focus-visible{background:#c9a24a22;outline:none}
`;

export function authResultPage(options: AuthPageOptions): string {
    const { ok, title, message, state, appUrl } = options;
    const origin = new URL(appUrl).origin;
    // The app may have lost track of this window, so nudge it two ways: the
    // opener when there is one (COOP usually severs it), and a broadcast to
    // the app's other tabs. Either way the app polls for the outcome.
    const script = state
        ? `<script>(function(){var m={type:'trx-suite-auth',state:${scriptJson(state)}};
try{if(window.opener)window.opener.postMessage(m,${scriptJson(origin)})}catch(e){}
try{var c=new BroadcastChannel('trx-suite-auth');c.postMessage(m);c.close()}catch(e){}
${ok ? 'setTimeout(function(){try{window.close()}catch(e){}},400);' : ''}})();</script>`
        : '';
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)} · tombs.nexus</title>
<style>${STYLE}</style>
</head>
<body>
<main class="${ok ? 'ok' : 'err'}">
<div class="seal" aria-hidden="true"><span>${ok ? '&#10022;' : '&#10005;'}</span></div>
<h1>${escapeHtml(title)}</h1>
<div class="rule"></div>
<p>${escapeHtml(message)}</p>
<p class="hint">${ok ? 'You can close this window and return to the app.' : 'Close this window and try again from the app.'}</p>
<a href="${escapeHtml(appUrl)}/">Return to the app</a>
</main>
${script}
</body>
</html>
`;
}
