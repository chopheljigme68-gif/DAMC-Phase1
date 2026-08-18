// const nodemailer = require("nodemailer");

// // Four tiers, in priority order:
// //   1. AgentMail (AGENTMAIL_API_KEY set) — free, no domain verification
// //      needed, can send to anyone right away. The tradeoff: mail comes from
// //      an @agentmail.to address, not a DAMC-recognizable one, so it's more
// //      likely to look unfamiliar or get caught by spam filters than a
// //      verified-domain sender would.
// //   2. Resend (RESEND_API_KEY set) — the better long-term path once a real
// //      domain is verified; until then it can only deliver to the email tied
// //      to the Resend account itself.
// //   3. SMTP (SMTP_HOST/SMTP_USER/SMTP_PASS set) — e.g. Gmail with an App
// //      Password, or your own mail server.
// //   4. Console log — local dev with nothing configured. Fully functional
// //      for testing the invite/reset LOGIC without sending real mail.
// let agentMailClient = null;
// let agentMailInboxId = null; // resolved once, then reused for every send
// let resendClient = null;
// let smtpTransporter = null;
// let mode = null; // "agentmail" | "resend" | "smtp" | "console"

// function getMode() {
//   if (mode) return mode;
//   if (process.env.AGENTMAIL_API_KEY) mode = "agentmail";
//   else if (process.env.RESEND_API_KEY) mode = "resend";
//   else if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) mode = "smtp";
//   else mode = "console";
//   return mode;
// }

// function getAgentMail() {
//   if (agentMailClient) return agentMailClient;
//   const { AgentMailClient } = require("agentmail");
//   agentMailClient = new AgentMailClient({ apiKey: process.env.AGENTMAIL_API_KEY });
//   return agentMailClient;
// }

// // Creates the sending inbox once, then reuses it for every future send —
// // an inbox is a persistent mailbox, not something to recreate per email.
// // Passing the same clientId every time makes this call idempotent: after
// // the first real creation, every later call (even across server restarts)
// // just returns the SAME existing inbox instead of making a new one.
// async function getAgentMailInboxId() {
//   if (agentMailInboxId) return agentMailInboxId;
//   const client = getAgentMail();
//   const inbox = await client.inboxes.create({
//     username: process.env.AGENTMAIL_INBOX_USERNAME || "pmdamc",
//     clientId: "pmdamc-invites",
//   });
//   agentMailInboxId = inbox.inboxId;
//   return agentMailInboxId;
// }

// function getResend() {
//   if (resendClient) return resendClient;
//   const { Resend } = require("resend");
//   resendClient = new Resend(process.env.RESEND_API_KEY);
//   return resendClient;
// }

// function getSmtp() {
//   if (smtpTransporter) return smtpTransporter;
//   smtpTransporter = nodemailer.createTransport({
//     host: process.env.SMTP_HOST,
//     port: Number(process.env.SMTP_PORT || 587),
//     secure: process.env.SMTP_SECURE === "true",
//     auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
//   });
//   return smtpTransporter;
// }

// // MAIL_FROM should be a plain address like "onboarding@resend.dev" until a
// // custom domain is verified in Resend — sending from anything else will be
// // rejected by their API before your own domain is verified. Once DAMC's
// // domain is verified in the Resend dashboard, just change MAIL_FROM to
// // something like "PMDAMC <notifications@damc.gov.bt>" — nothing else here
// // needs to change. Not used at all in AgentMail mode — that sender address
// // is whatever inbox was created (see AGENTMAIL_INBOX_USERNAME above).
// function fromAddress() {
//   return process.env.MAIL_FROM || "PMDAMC <onboarding@resend.dev>";
// }

// async function send({ to, subject, text, html }) {
//   const currentMode = getMode();

//   if (currentMode === "agentmail") {
//     const client = getAgentMail();
//     const inboxId = await getAgentMailInboxId();
//     await client.inboxes.messages.send(inboxId, { to, subject, text, html });
//     return null;
//   }

//   if (currentMode === "resend") {
//     const resend = getResend();
//     const { data, error } = await resend.emails.send({ from: fromAddress(), to, subject, text, html });
//     if (error) throw new Error(error.message || "Resend failed to send the email");
//     return data;
//   }

//   if (currentMode === "smtp") {
//     const t = getSmtp();
//     await t.sendMail({ from: fromAddress(), to, subject, text, html });
//     return null;
//   }

//   // console fallback
//   console.log("\n📧  (No email provider configured — printing email instead of sending it)");
//   console.log(`    To: ${to}`);
//   console.log(`    Subject: ${subject}`);
//   console.log(`    ${text.split("\n").join("\n    ")}\n`);
//   console.log(`ℹ️  Set AGENTMAIL_API_KEY, RESEND_API_KEY, or SMTP_HOST/SMTP_USER/SMTP_PASS in .env to actually deliver this instead of printing it.`);
//   return null;
// }

// // Small, clean HTML wrapper shared by every email below — keeps them
// // readable in real inboxes without pulling in a templating dependency.
// const wrapHtml = (heading, bodyHtml, ctaUrl, ctaLabel) => `
// <div style="font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #171a22;">
//   <h2 style="margin: 0 0 16px; font-size: 20px;">${heading}</h2>
//   <div style="font-size: 14px; line-height: 1.6; color: #3a3f4c;">${bodyHtml}</div>
//   ${ctaUrl ? `<a href="${ctaUrl}" style="display: inline-block; margin-top: 20px; background: #1F7D3B; color: #ffffff; text-decoration: none; padding: 10px 18px; border-radius: 8px; font-size: 14px; font-weight: 600;">${ctaLabel}</a>` : ""}
//   <div style="margin-top: 28px; font-size: 12px; color: #9098aa;">PMDAMC — Department of Agriculture Marketing and Cooperatives</div>
// </div>`;

// async function sendPasswordResetEmail({ to, resetUrl }) {
//   await send({
//     to,
//     subject: "Reset your PMDAMC password",
//     text: `Someone (hopefully you) requested a password reset.\n\nReset it here (valid for 1 hour):\n${resetUrl}\n\nIf you didn't request this, you can ignore this email.`,
//     html: wrapHtml(
//       "Reset your password",
//       `Someone (hopefully you) requested a password reset for your PMDAMC account.<br><br>This link is valid for 1 hour. If you didn't request this, you can safely ignore this email.`,
//       resetUrl,
//       "Reset password"
//     ),
//   });
// }

// // Sent when someone who already has an account gets added straight to a
// // workspace (the "existing user" invite path) — they get an in-app
// // notification too, but not everyone checks the app right away.
// async function sendAddedToWorkspaceEmail({ to, workspaceName, invitedByName, appUrl }) {
//   await send({
//     to,
//     subject: `You've been added to ${workspaceName}`,
//     text: `${invitedByName} added you to the "${workspaceName}" workspace.\n\nSign in to see it:\n${appUrl}`,
//     html: wrapHtml(
//       `You're in ${workspaceName}`,
//       `${invitedByName} added you to the <strong>${workspaceName}</strong> workspace on PMDAMC. It's already there waiting — no extra steps needed.`,
//       appUrl,
//       "Open PMDAMC"
//     ),
//   });
// }

// // Sent when someone WITHOUT an account yet is invited. The link includes
// // their email pre-filled so the registration form doesn't ask them to
// // retype it — one less place to introduce a typo that would break the
// // automatic workspace join, which matches on email address.
// async function sendInviteEmail({ to, workspaceName, invitedByName, appUrl }) {
//   const registerUrl = `${appUrl}/register?email=${encodeURIComponent(to)}`;
//   await send({
//     to,
//     subject: `${invitedByName} invited you to ${workspaceName}`,
//     text: `${invitedByName} invited you to join the "${workspaceName}" workspace on PMDAMC.\n\nCreate your account here and you'll be added automatically:\n${registerUrl}`,
//     html: wrapHtml(
//       `You're invited to ${workspaceName}`,
//       `${invitedByName} invited you to join the <strong>${workspaceName}</strong> workspace on PMDAMC. Create your account with this same email address and you'll be added straight in — no separate approval step.`,
//       registerUrl,
//       "Create your account"
//     ),
//   });
// }

// module.exports = { sendPasswordResetEmail, sendAddedToWorkspaceEmail, sendInviteEmail };

















//Code 2:
const nodemailer = require("nodemailer");

// Four tiers, in priority order:
//   1. AgentMail (AGENTMAIL_API_KEY set) — free, no domain verification
//      needed, can send to anyone right away. The tradeoff: mail comes from
//      an @agentmail.to address, not a DAMC-recognizable one, so it's more
//      likely to look unfamiliar or get caught by spam filters than a
//      verified-domain sender would.
//   2. Resend (RESEND_API_KEY set) — the better long-term path once a real
//      domain is verified; until then it can only deliver to the email tied
//      to the Resend account itself.
//   3. SMTP (SMTP_HOST/SMTP_USER/SMTP_PASS set) — e.g. Gmail with an App
//      Password, or your own mail server.
//   4. Console log — local dev with nothing configured. Fully functional
//      for testing the invite/reset LOGIC without sending real mail.
let agentMailClient = null;
let agentMailInboxId = null; // resolved once, then reused for every send
let resendClient = null;
let smtpTransporter = null;
let mode = null; // "agentmail" | "resend" | "smtp" | "console"

function getMode() {
  if (mode) return mode;
  if (process.env.AGENTMAIL_API_KEY) mode = "agentmail";
  else if (process.env.RESEND_API_KEY) mode = "resend";
  else if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) mode = "smtp";
  else mode = "console";
  return mode;
}

function getAgentMail() {
  if (agentMailClient) return agentMailClient;
  const { AgentMailClient } = require("agentmail");
  agentMailClient = new AgentMailClient({ apiKey: process.env.AGENTMAIL_API_KEY });
  return agentMailClient;
}

// Creates the sending inbox once, then reuses it for every future send —
// an inbox is a persistent mailbox, not something to recreate per email.
// Passing the same clientId every time makes this call idempotent: after
// the first real creation, every later call (even across server restarts)
// just returns the SAME existing inbox instead of making a new one.
async function getAgentMailInboxId() {
  if (agentMailInboxId) return agentMailInboxId;
  const client = getAgentMail();
  const inbox = await client.inboxes.create({
    username: process.env.AGENTMAIL_INBOX_USERNAME || "pmdamc",
    clientId: "pmdamc-invites",
  });
  agentMailInboxId = inbox.inboxId;
  return agentMailInboxId;
}

function getResend() {
  if (resendClient) return resendClient;
  const { Resend } = require("resend");
  resendClient = new Resend(process.env.RESEND_API_KEY);
  return resendClient;
}

function getSmtp() {
  if (smtpTransporter) return smtpTransporter;
  smtpTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return smtpTransporter;
}

// MAIL_FROM should be a plain address like "onboarding@resend.dev" until a
// custom domain is verified in Resend — sending from anything else will be
// rejected by their API before your own domain is verified. Once DAMC's
// domain is verified in the Resend dashboard, just change MAIL_FROM to
// something like "PMDAMC <notifications@damc.gov.bt>" — nothing else here
// needs to change. Not used at all in AgentMail mode — that sender address
// is whatever inbox was created (see AGENTMAIL_INBOX_USERNAME above).
function fromAddress() {
  return process.env.MAIL_FROM || "PMDAMC <onboarding@resend.dev>";
}

async function send({ to, subject, text, html }) {
  const currentMode = getMode();

  if (currentMode === "agentmail") {
    const client = getAgentMail();
    const inboxId = await getAgentMailInboxId();
    const result = await client.inboxes.messages.send(inboxId, { to, subject, text, html });
    console.log(`✅ Email sent via AgentMail — to: ${to}, subject: "${subject}", messageId: ${result?.messageId || "(none returned)"}`);
    return result;
  }

  if (currentMode === "resend") {
    const resend = getResend();
    const { data, error } = await resend.emails.send({ from: fromAddress(), to, subject, text, html });
    if (error) throw new Error(error.message || "Resend failed to send the email");
    console.log(`✅ Email sent via Resend — to: ${to}, subject: "${subject}", id: ${data?.id || "(none returned)"}`);
    return data;
  }

  if (currentMode === "smtp") {
    const t = getSmtp();
    const info = await t.sendMail({ from: fromAddress(), to, subject, text, html });
    console.log(`✅ Email sent via SMTP — to: ${to}, subject: "${subject}", messageId: ${info?.messageId || "(none returned)"}`);
    return info;
  }

  // console fallback
  console.log("\n📧  (No email provider configured — printing email instead of sending it)");
  console.log(`    To: ${to}`);
  console.log(`    Subject: ${subject}`);
  console.log(`    ${text.split("\n").join("\n    ")}\n`);
  console.log(`ℹ️  Set AGENTMAIL_API_KEY, RESEND_API_KEY, or SMTP_HOST/SMTP_USER/SMTP_PASS in .env to actually deliver this instead of printing it.`);
  return null;
}

// Small, clean HTML wrapper shared by every email below — keeps them
// readable in real inboxes without pulling in a templating dependency.
const wrapHtml = (heading, bodyHtml, ctaUrl, ctaLabel) => `
<div style="font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #171a22;">
  <h2 style="margin: 0 0 16px; font-size: 20px;">${heading}</h2>
  <div style="font-size: 14px; line-height: 1.6; color: #3a3f4c;">${bodyHtml}</div>
  ${ctaUrl ? `<a href="${ctaUrl}" style="display: inline-block; margin-top: 20px; background: #1F7D3B; color: #ffffff; text-decoration: none; padding: 10px 18px; border-radius: 8px; font-size: 14px; font-weight: 600;">${ctaLabel}</a>` : ""}
  <div style="margin-top: 28px; font-size: 12px; color: #9098aa;">PMDAMC — Department of Agriculture Marketing and Cooperatives</div>
</div>`;

async function sendPasswordResetEmail({ to, resetUrl }) {
  await send({
    to,
    subject: "Reset your PMDAMC password",
    text: `Someone (hopefully you) requested a password reset.\n\nReset it here (valid for 1 hour):\n${resetUrl}\n\nIf you didn't request this, you can ignore this email.`,
    html: wrapHtml(
      "Reset your password",
      `Someone (hopefully you) requested a password reset for your PMDAMC account.<br><br>This link is valid for 1 hour. If you didn't request this, you can safely ignore this email.`,
      resetUrl,
      "Reset password"
    ),
  });
}

// Sent when someone who already has an account gets added straight to a
// workspace (the "existing user" invite path) — they get an in-app
// notification too, but not everyone checks the app right away.
async function sendAddedToWorkspaceEmail({ to, workspaceName, invitedByName, appUrl }) {
  await send({
    to,
    subject: `You've been added to ${workspaceName}`,
    text: `${invitedByName} added you to the "${workspaceName}" workspace.\n\nSign in to see it:\n${appUrl}`,
    html: wrapHtml(
      `You're in ${workspaceName}`,
      `${invitedByName} added you to the <strong>${workspaceName}</strong> workspace on PMDAMC. It's already there waiting — no extra steps needed.`,
      appUrl,
      "Open PMDAMC"
    ),
  });
}

// Sent when someone WITHOUT an account yet is invited. The link includes
// their email pre-filled so the registration form doesn't ask them to
// retype it — one less place to introduce a typo that would break the
// automatic workspace join, which matches on email address.
async function sendInviteEmail({ to, workspaceName, invitedByName, appUrl }) {
  const registerUrl = `${appUrl}/register?email=${encodeURIComponent(to)}`;
  await send({
    to,
    subject: `${invitedByName} invited you to ${workspaceName}`,
    text: `${invitedByName} invited you to join the "${workspaceName}" workspace on PMDAMC.\n\nCreate your account here and you'll be added automatically:\n${registerUrl}`,
    html: wrapHtml(
      `You're invited to ${workspaceName}`,
      `${invitedByName} invited you to join the <strong>${workspaceName}</strong> workspace on PMDAMC. Create your account with this same email address and you'll be added straight in — no separate approval step.`,
      registerUrl,
      "Create your account"
    ),
  });
}

module.exports = { sendPasswordResetEmail, sendAddedToWorkspaceEmail, sendInviteEmail };