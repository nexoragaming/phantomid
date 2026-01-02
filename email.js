import { Resend } from "resend";

export const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendWelcomeEmail({ email, username, phantomId }) {
  try {
    await resend.emails.send({
      from: "PhantomID <onboarding@resend.dev>", // temporaire OK
      to: email,
      subject: "Welcome to PhantomID",
      html: `
        <p>Hi ${username},</p>

        <p>Welcome to <strong>PhantomID</strong> — your competitive gaming identity.</p>

        <p>Your PhantomID (<strong>${phantomId}</strong>) has been successfully created and securely linked to your Discord account.</p>

        <p>If you did not create this account, please contact us immediately.</p>

        <p>
          Welcome aboard,<br />
          <strong>The PhantomID Team</strong><br />
          NexoraGaming
        </p>
      `,
    });
  } catch (err) {
    console.error("Welcome email failed:", err);
  }
}
