const nodemailer = require("nodemailer");

let transporter = null;
let usingRealSmtp = false;

function getTransporter() {
  if (transporter) return transporter;

  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === "true",
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    usingRealSmtp = true;
  } else {
    // Dev fallback: no real email is sent, the link is logged to the server
    // console instead. Fully functional for local testing — set SMTP_* in
    // .env to send real emails once you deploy.
    transporter = {
      sendMail: async ({ to, subject, text }) => {
        console.log("\n📧  (No SMTP configured — printing email instead of sending it)");
        console.log(`    To: ${to}`);
        console.log(`    Subject: ${subject}`);
        console.log(`    ${text.split("\n").join("\n    ")}\n`);
      },
    };
    usingRealSmtp = false;
  }
  return transporter;
}

async function sendPasswordResetEmail({ to, resetUrl }) {
  const t = getTransporter();
  await t.sendMail({
    from: process.env.MAIL_FROM || "Team Flow Hub <no-reply@teamflowhub.local>",
    to,
    subject: "Reset your Team Flow Hub password",
    text: `Someone (hopefully you) requested a password reset.\n\nReset it here (valid for 1 hour):\n${resetUrl}\n\nIf you didn't request this, you can ignore this email.`,
  });
  if (!usingRealSmtp) {
    console.log(`ℹ️  Set SMTP_HOST/SMTP_USER/SMTP_PASS in .env to actually deliver this instead of printing it.`);
  }
}

// Sent when someone who already has an account gets added straight to a
// workspace (the "existing user" invite path) — they get an in-app
// notification too, but not everyone checks the app right away.
async function sendAddedToWorkspaceEmail({ to, workspaceName, invitedByName, appUrl }) {
  const t = getTransporter();
  await t.sendMail({
    from: process.env.MAIL_FROM || "Team Flow Hub <no-reply@teamflowhub.local>",
    to,
    subject: `You've been added to ${workspaceName}`,
    text: `${invitedByName} added you to the "${workspaceName}" workspace.\n\nSign in to see it:\n${appUrl}`,
  });
  if (!usingRealSmtp) {
    console.log(`ℹ️  Set SMTP_HOST/SMTP_USER/SMTP_PASS in .env to actually deliver this instead of printing it.`);
  }
}

// Sent when someone WITHOUT an account yet is invited — they need to know
// to register, since nothing shows up for them in-app until they do.
async function sendInviteEmail({ to, workspaceName, invitedByName, appUrl }) {
  const t = getTransporter();
  await t.sendMail({
    from: process.env.MAIL_FROM || "Team Flow Hub <no-reply@teamflowhub.local>",
    to,
    subject: `${invitedByName} invited you to ${workspaceName}`,
    text: `${invitedByName} invited you to join the "${workspaceName}" workspace.\n\nCreate an account with this same email address (${to}) and you'll be added automatically:\n${appUrl}/register`,
  });
  if (!usingRealSmtp) {
    console.log(`ℹ️  Set SMTP_HOST/SMTP_USER/SMTP_PASS in .env to actually deliver this instead of printing it.`);
  }
}

module.exports = { sendPasswordResetEmail, sendAddedToWorkspaceEmail, sendInviteEmail };
