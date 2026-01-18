import logger from "logger";
import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

export interface SendInvitationEmailParams {
  to: string;
  inviterName: string;
  role: string;
  inviteLink: string;
  expiresInDays: number;
}

export async function sendInvitationEmail({
  to,
  inviterName,
  role,
  inviteLink,
  expiresInDays,
}: SendInvitationEmailParams): Promise<{ success: boolean; error?: string }> {
  if (!resend) {
    logger.warn(
      "RESEND_API_KEY not configured. Skipping invitation email send.",
    );
    return { success: false, error: "Email service not configured" };
  }

  const fromEmail =
    process.env.RESEND_FROM_EMAIL || "Shadower <onboarding@resend.dev>";

  try {
    const { data, error } = await resend.emails.send({
      from: fromEmail,
      to,
      subject: `${inviterName} has invited you to join Shadower`,
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>You've been invited to Shadower</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
    <h1 style="color: white; margin: 0; font-size: 28px;">You've been invited!</h1>
  </div>
  
  <div style="background: #f8f9fa; padding: 30px; border: 1px solid #e9ecef; border-top: none;">
    <p style="font-size: 16px; margin-bottom: 20px;">
      <strong>${inviterName}</strong> has invited you to join <strong>Shadower</strong> as a <strong>${role}</strong>.
    </p>
    
    <p style="font-size: 14px; color: #666; margin-bottom: 25px;">
      Shadower is an AI-powered conversational platform that helps you automate workflows and work smarter.
    </p>
    
    <div style="text-align: center; margin: 30px 0;">
      <a href="${inviteLink}" style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; padding: 14px 30px; border-radius: 8px; font-weight: 600; font-size: 16px;">
        Accept Invitation
      </a>
    </div>
    
    <p style="font-size: 13px; color: #888; margin-top: 25px; text-align: center;">
      This invitation expires in <strong>${expiresInDays} days</strong>.
    </p>
    
    <hr style="border: none; border-top: 1px solid #e9ecef; margin: 25px 0;">
    
    <p style="font-size: 12px; color: #999; margin: 0;">
      If you didn't expect this invitation, you can safely ignore this email.
    </p>
    <p style="font-size: 12px; color: #999; margin-top: 10px;">
      If the button doesn't work, copy and paste this link into your browser:<br>
      <a href="${inviteLink}" style="color: #667eea; word-break: break-all;">${inviteLink}</a>
    </p>
  </div>
  
  <div style="background: #f1f3f4; padding: 15px; border-radius: 0 0 12px 12px; text-align: center;">
    <p style="font-size: 12px; color: #666; margin: 0;">
      © ${new Date().getFullYear()} Shadower. All rights reserved.
    </p>
  </div>
</body>
</html>
      `,
    });

    if (error) {
      logger.error("Failed to send invitation email:", error);
      return { success: false, error: error.message };
    }

    logger.info(`Invitation email sent to ${to}`, { messageId: data?.id });
    return { success: true };
  } catch (error) {
    logger.error("Error sending invitation email:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
