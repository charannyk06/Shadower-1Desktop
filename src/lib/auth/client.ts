"use client";

import { inferAdditionalFields } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react"; // make sure to import from better-auth/react

import type { auth } from "./auth-instance";

export const authClient = createAuthClient({
  plugins: [inferAdditionalFields<typeof auth>()],
});
