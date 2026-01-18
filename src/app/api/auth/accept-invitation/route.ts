import { getInvitationStatus } from "app-types/invitation";
import { auth } from "lib/auth/server";
import { invitationRepository, userRepository } from "lib/db/repository";
import { passwordSchema } from "lib/validations/password";
import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const AcceptInvitationSchema = z.object({
  token: z.string().min(1, "Token is required"),
  name: z.string().min(1, "Name is required").max(100),
  password: passwordSchema,
});

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");

  if (!token) {
    return NextResponse.json({ error: "Token required" }, { status: 400 });
  }

  const invitation = await invitationRepository.getByToken(token);

  if (!invitation) {
    return NextResponse.json(
      { error: "Invitation not found" },
      { status: 404 },
    );
  }

  const status = getInvitationStatus(invitation);

  return NextResponse.json({
    email: invitation.email,
    role: invitation.role,
    inviterName: invitation.inviterName,
    status,
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate input
    const parseResult = AcceptInvitationSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error.issues[0].message },
        { status: 400 },
      );
    }

    const { token, name, password } = parseResult.data;

    const invitation = await invitationRepository.getByToken(token);

    if (!invitation) {
      return NextResponse.json(
        { error: "Invitation not found" },
        { status: 404 },
      );
    }

    const status = getInvitationStatus(invitation);

    if (status !== "pending") {
      return NextResponse.json(
        { error: `Invitation is ${status}` },
        { status: 400 },
      );
    }

    // Check if email already registered
    const existingUser = await userRepository.existsByEmail(invitation.email);
    if (existingUser) {
      return NextResponse.json(
        { error: "Email already registered" },
        { status: 400 },
      );
    }

    // Create user with Better Auth
    const { user } = await auth.api.signUpEmail({
      body: {
        email: invitation.email,
        password,
        name,
      },
      headers: await headers(),
    });

    // Update user role to the invited role
    await auth.api.setRole({
      body: { userId: user.id, role: invitation.role } as any,
      headers: await headers(),
    });

    // Mark invitation as accepted
    await invitationRepository.markAsAccepted(token);

    return NextResponse.json({
      success: true,
      message: "Account created successfully",
    });
  } catch (error) {
    console.error("Failed to accept invitation:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to create account",
      },
      { status: 500 },
    );
  }
}
