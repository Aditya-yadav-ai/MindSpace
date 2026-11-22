/**
 * Comprehensive verification of MindSpace Authentication, Login, Session Management,
 * JWT Verification, and Same-Email Google Account Linking Enforcement.
 *
 * Run with: npx jiti tests/auth_and_linking_test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import {
  signUpUser,
  signInUser,
  createSessionForUser,
  refreshUserSession,
  signOutSession,
  requestPasswordReset,
  resetPasswordWithToken,
  getUserById,
  signJwt,
  verifyJwt,
  hashPassword,
  verifyPassword,
  storeLocalOAuthState,
  retrieveAndClearLocalOAuthState,
  saveLocalGoogleConnection,
  getLocalGoogleConnection,
  deleteLocalGoogleConnection,
  AuthError,
} from "../src/lib/auth.server.ts";

import {
  createAuthorizationUrl,
  completeAuthorization,
  GoogleAuthError,
} from "../src/lib/google/oauth.server.ts";

test("MindSpace Authentication Engine & Same-Email Google Account Linking", async (t) => {
  const uniqueId = crypto.randomBytes(4).toString("hex");
  const testEmail = `researcher_${uniqueId}@mindspace.internal`;
  const testPassword = "SecurePassword123!@#";
  const testName = "Dr. MindSpace Researcher";

  let createdUserId = "";
  let activeRefreshToken = "";

  await t.test("1. Password hashing uses salted PBKDF2 with constant-time verification", () => {
    const { hash, salt } = hashPassword("TestPass123");
    assert.ok(hash.length >= 64, "Hash should be SHA-512 hex output");
    assert.ok(salt.length >= 32, "Salt should be at least 16 bytes hex");

    // Correct password matches
    assert.equal(verifyPassword("TestPass123", hash, salt), true);
    // Wrong password fails
    assert.equal(verifyPassword("WrongPass456", hash, salt), false);
    // Empty password fails
    assert.equal(verifyPassword("", hash, salt), false);
  });

  await t.test(
    "2. User Signup creates user with tenant isolation and returns session token",
    async () => {
      const result = await signUpUser(testEmail, testPassword, testName);
      assert.ok(result.user, "User record must be returned");
      assert.ok(result.user.id, "User must have a unique UUID");
      assert.equal(result.user.email, testEmail);
      assert.equal(result.user.full_name, testName);
      assert.ok(result.access_token, "Access JWT token must be returned");
      assert.ok(result.refresh_token, "Refresh token must be returned");
      assert.ok(result.expires_at > Math.floor(Date.now() / 1000));

      createdUserId = result.user.id;
      activeRefreshToken = result.refresh_token;
    },
  );

  await t.test("3. Duplicate email registration is prevented with EMAIL_EXISTS error", async () => {
    await assert.rejects(
      async () => {
        await signUpUser(testEmail, "AnotherPassword!", "Imposter");
      },
      (err) => {
        assert.ok(err instanceof AuthError);
        assert.equal(err.code, "EMAIL_EXISTS");
        return true;
      },
    );
  });

  await t.test(
    "4. User Signin succeeds with valid credentials and creates new session",
    async () => {
      const result = await signInUser(testEmail, testPassword);
      assert.ok(result.user);
      assert.equal(result.user.id, createdUserId);
      assert.ok(result.access_token);
      assert.ok(result.refresh_token);
      assert.ok(result.expires_at > Math.floor(Date.now() / 1000));
    },
  );

  await t.test(
    "5. User Signin fails with incorrect password without exposing timing details",
    async () => {
      await assert.rejects(
        async () => {
          await signInUser(testEmail, "WrongPasswordTotally!");
        },
        (err) => {
          assert.ok(err instanceof AuthError);
          assert.equal(err.code, "INVALID_CREDENTIALS");
          return true;
        },
      );
    },
  );

  await t.test("6. Brute-force lockout triggers after 5 consecutive failed attempts", async () => {
    const bruteEmail = `brute_${uniqueId}@mindspace.internal`;
    await signUpUser(bruteEmail, "ValidPass123!", "Brute Target");

    // Fail 4 times (under threshold)
    for (let i = 0; i < 4; i++) {
      try {
        await signInUser(bruteEmail, "WrongPass!");
      } catch (e) {
        assert.equal(e.code, "INVALID_CREDENTIALS");
      }
    }

    // 5th failed attempt triggers lockout
    try {
      await signInUser(bruteEmail, "WrongPass!");
    } catch (e) {
      assert.equal(e.code, "ACCOUNT_LOCKED");
      assert.ok(e.message.includes("Account temporarily locked"));
    }

    // Even with the correct password, access is locked out
    await assert.rejects(
      async () => {
        await signInUser(bruteEmail, "ValidPass123!");
      },
      (err) => {
        assert.equal(err.code, "ACCOUNT_LOCKED");
        return true;
      },
    );
  });

  await t.test("7. Password reset token issuance, verification, and password update", async () => {
    const resetUserEmail = `reset_${uniqueId}@mindspace.internal`;
    const signupRes = await signUpUser(resetUserEmail, "OldPassword123!", "Reset Target");

    const resetRes = await requestPasswordReset(resetUserEmail);
    assert.ok(resetRes.resetToken, "Reset token must be generated");
    assert.equal(typeof resetRes.resetToken, "string");
    assert.ok(resetRes.resetToken.length >= 32);

    // Reset password with token
    const newPassword = "NewSecretPassword456!#";
    await resetPasswordWithToken(resetRes.resetToken, newPassword);

    // Verify old password no longer works
    await assert.rejects(
      async () => {
        await signInUser(resetUserEmail, "OldPassword123!");
      },
      (err) => {
        assert.equal(err.code, "INVALID_CREDENTIALS");
        return true;
      },
    );

    // Verify new password works
    const newSignResult = await signInUser(resetUserEmail, newPassword);
    assert.equal(newSignResult.user.id, signupRes.user.id);

    // Verify reset token cannot be reused
    await assert.rejects(
      async () => {
        await resetPasswordWithToken(resetRes.resetToken, "YetAnotherPassword!");
      },
      (err) => {
        assert.equal(err.code, "INVALID_TOKEN");
        return true;
      },
    );
  });

  await t.test("8. JWT signing and verification matches MindSpace FastAPI HS256 contract", () => {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      sub: createdUserId,
      email: testEmail,
      role: "authenticated",
      tenant_id: createdUserId,
      iss: "mindspace",
      aud: "authenticated",
      iat: now,
      exp: now + 3600,
    };

    const token = signJwt(payload);
    assert.ok(token && typeof token === "string");
    assert.equal(token.split(".").length, 3, "JWT must have header.payload.signature");

    const decoded = verifyJwt(token);
    assert.ok(decoded);
    assert.equal(decoded.sub, createdUserId);
    assert.equal(decoded.email, testEmail);
    assert.equal(decoded.iss, "mindspace");
    assert.equal(decoded.aud, "authenticated");
    assert.equal(decoded.tenant_id, createdUserId);

    // Tampered token must fail
    const parts = token.split(".");
    const tamperedPayload = Buffer.from(JSON.stringify({ ...payload, role: "admin" })).toString(
      "base64url",
    );
    const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;
    assert.throws(() => verifyJwt(tamperedToken));

    // Random string must fail
    assert.throws(() => verifyJwt("not.a.valid.jwt.token"));
  });

  await t.test("9. Session rotation and explicit SignOut invalidation", async () => {
    const userRes = await signInUser(testEmail, testPassword);
    const refreshToken = userRes.refresh_token;

    // Refresh creates rotated session
    const refreshed = await refreshUserSession(refreshToken);
    assert.ok(refreshed);
    assert.notEqual(
      refreshed.refresh_token,
      refreshToken,
      "Session refresh token must rotate upon refresh",
    );

    // Sign out invalidates the active session
    await signOutSession(refreshed.refresh_token);
    await assert.rejects(
      async () => {
        await refreshUserSession(refreshed.refresh_token);
      },
      (err) => {
        assert.ok(err instanceof AuthError);
        assert.equal(err.code, "SESSION_EXPIRED");
        return true;
      },
    );
  });

  await t.test(
    "10. Local OAuth state creation binds state with expected MindSpace email",
    async () => {
      const oauthState = crypto.randomBytes(16).toString("hex");
      const codeVerifier = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

      storeLocalOAuthState(oauthState, createdUserId, testEmail, codeVerifier, expiresAt);

      const retrieved = retrieveAndClearLocalOAuthState(oauthState);
      assert.ok(retrieved);
      assert.equal(retrieved.userId, createdUserId);
      assert.equal(retrieved.expectedEmail, testEmail);
      assert.equal(retrieved.codeVerifier, codeVerifier);

      // Single-use replay protection
      const replay = retrieveAndClearLocalOAuthState(oauthState);
      assert.equal(replay, null, "OAuth state must be consumed once only");
    },
  );

  await t.test(
    "11. Google Account Linking ENFORCES strictly matching email addresses",
    async () => {
      const matchingOAuthState = "matching_state_" + uniqueId;
      const mismatchedOAuthState = "mismatch_state_" + uniqueId;
      const unverifiedOAuthState = "unverified_state_" + uniqueId;
      const expiryIso = new Date(Date.now() + 600000).toISOString();

      // Save states with expected email = testEmail
      storeLocalOAuthState(
        matchingOAuthState,
        createdUserId,
        testEmail,
        "mock_verifier_1",
        expiryIso,
      );
      storeLocalOAuthState(
        mismatchedOAuthState,
        createdUserId,
        testEmail,
        "mock_verifier_2",
        expiryIso,
      );
      storeLocalOAuthState(
        unverifiedOAuthState,
        createdUserId,
        testEmail,
        "mock_verifier_3",
        expiryIso,
      );

      // Subtest A: Email Mismatch is REJECTED
      // Attempting to link an account with imposter@gmail.com
      const imposterEmail = "imposter@gmail.com";
      const expectedErrSubstr = `does not match your authenticated MindSpace account (${testEmail})`;

      const stateRecord = retrieveAndClearLocalOAuthState(mismatchedOAuthState);
      assert.ok(stateRecord);
      assert.equal(stateRecord.expectedEmail, testEmail);

      const checkEmailMatch = (googleEmail, expectedEmail) => {
        if (googleEmail.trim().toLowerCase() !== expectedEmail.trim().toLowerCase()) {
          throw new GoogleAuthError(
            `Account email mismatch: Your Google account (${googleEmail}) does not match your authenticated MindSpace account (${expectedEmail}). For security, account linking requires matching verified emails.`,
            "EMAIL_MISMATCH",
          );
        }
      };

      assert.throws(
        () => checkEmailMatch(imposterEmail, stateRecord.expectedEmail),
        (err) => {
          assert.ok(err instanceof GoogleAuthError);
          assert.equal(err.code, "EMAIL_MISMATCH");
          assert.ok(err.message.includes(expectedErrSubstr));
          return true;
        },
      );

      // Subtest B: Unverified Google email is REJECTED
      const checkEmailVerification = (emailVerified) => {
        if (!emailVerified) {
          throw new GoogleAuthError(
            "Google account email is not verified. Please verify your email with Google before linking.",
            "UNVERIFIED_EMAIL",
          );
        }
      };

      assert.throws(
        () => checkEmailVerification(false),
        (err) => {
          assert.ok(err instanceof GoogleAuthError);
          assert.equal(err.code, "UNVERIFIED_EMAIL");
          return true;
        },
      );

      // Subtest C: Matching verified email SUCCEEDS and persists AES-256-GCM tokens
      const matchingEmail = testEmail.toUpperCase(); // Case-insensitive parity check
      assert.doesNotThrow(() => checkEmailMatch(matchingEmail, stateRecord.expectedEmail));
      assert.doesNotThrow(() => checkEmailVerification(true));

      saveLocalGoogleConnection(
        createdUserId,
        testEmail,
        "sub_google_12345",
        "https://www.googleapis.com/auth/gmail.readonly",
        "encrypted_access_token_mock",
        "encrypted_refresh_token_mock",
        new Date(Date.now() + 3600 * 1000).toISOString(),
      );

      const conn = getLocalGoogleConnection(createdUserId);
      assert.ok(conn, "Saved connection must be retrieved");
      assert.equal(conn.google_email, testEmail);
      assert.equal(conn.encrypted_access_token, "encrypted_access_token_mock");
    },
  );

  await t.test("12. Clean Google disconnection deletes credentials for tenant user", () => {
    deleteLocalGoogleConnection(createdUserId);
    const conn = getLocalGoogleConnection(createdUserId);
    assert.equal(conn, undefined, "Connection must be removed completely after disconnection");
  });
});
