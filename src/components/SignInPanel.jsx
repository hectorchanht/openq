import { Box, Button, HStack, Input, Text, VStack } from "@chakra-ui/react";
import { useAtom } from "jotai";
import React from "react";
import {
  claimAlias, fetchMyAliases, fetchSessionUser,
  requestSignInLink, signOut, verifySignInCode,
} from "../libs/auth";
import { aliasAtom } from "../libs/jotaiAtoms";

// Sign-in + private page ownership — the Dawn standard flow replacing
// the old Gun username+password account:
//
//   email → one email carrying BOTH a sign-in BUTTON (magic link) and a
//   6-digit code → type the code here (works in the browser AND inside
//   the installed home-screen app, whose cookie jar the link can't
//   reach), or tap the button. Either one burns the other; both are
//   single-use and live 15 minutes.
//
// A signed-in user claims a page name (u/<alias>) — the claim is the
// ownership record. HONESTY NOTE (also in copy below): Gun accounts
// were keypairs with no email attached, so old Gun accounts CANNOT be
// migrated — there is nothing to map from. Page names are claimed
// fresh, first come first served.
//
// Anonymous queues need none of this and are untouched.
const SignInPanel = () => {
  const [, setAliasAtom] = useAtom(aliasAtom);
  const [user, setUser] = React.useState(null);
  const [ready, setReady] = React.useState(false);
  const [email, setEmail] = React.useState("");
  const [phase, setPhase] = React.useState("idle"); // idle | sending | sent | checking
  const [code, setCode] = React.useState("");
  const [note, setNote] = React.useState("");
  const [aliases, setAliases] = React.useState([]);
  const [pageName, setPageName] = React.useState("");
  const [claimNote, setClaimNote] = React.useState("");

  const loadAliases = React.useCallback(async () => {
    setAliases(await fetchMyAliases());
  }, []);

  React.useEffect(() => {
    let live = true;
    fetchSessionUser().then(async (u) => {
      if (!live) return;
      setUser(u);
      setReady(true);
      if (u) { setEmail(u.email); await loadAliases(); }
    });
    return () => { live = false; };
  }, [loadAliases]);

  const sendLink = async () => {
    setNote("");
    setPhase("sending");
    const r = await requestSignInLink(email.trim());
    if (r.ok) {
      setPhase("sent");
    } else {
      setPhase("idle");
      setNote(r.err === "rate-limited"
        ? "Too many sign-in emails — wait a few minutes and try again."
        : r.err === "not-configured"
          ? "Sign-in email isn't configured on the server yet."
          : "That email doesn't look right.");
    }
  };

  const submitCode = async () => {
    setNote("");
    setPhase("checking");
    const r = await verifySignInCode(email.trim(), code.trim());
    if (r.ok) {
      setUser(r.user);
      setPhase("idle");
      setCode("");
      await loadAliases();
    } else {
      setPhase("sent");
      setNote(r.err === "rate-limited"
        ? "Too many tries — wait a few minutes and request a fresh code."
        : "That code didn't work — codes expire in 15 minutes and stop working after 5 wrong tries.");
    }
  };

  const doClaim = async () => {
    setClaimNote("");
    const r = await claimAlias(pageName);
    if (r.ok) {
      setPageName("");
      await loadAliases();
      setAliasAtom(r.alias);
    } else {
      setClaimNote(r.err === "alias-taken"
        ? "That page name is already claimed by another account."
        : r.err === "invalid-alias"
          ? "Page names are 2–31 characters: letters, numbers, - and _."
          : "Couldn't claim that name — try again.");
    }
  };

  const doSignOut = async () => {
    await signOut();
    setUser(null);
    setAliases([]);
    setAliasAtom("");
  };

  if (!ready) return null;

  if (!user) {
    return (
      <Box borderTopWidth="1px" borderColor="whiteAlpha.200" pt={3}>
        <Text fontSize="sm" fontWeight="bold" mb={1}>🔑 Your private page</Text>
        <Text fontSize="xs" opacity={0.65} mb={2} lineHeight="1.5">
          Accounts are now by email — sign in with your email to own your
          page. (The old password accounts were Gun keypairs with no email
          attached, so they can&apos;t be carried over; page names are
          claimed fresh.) Queues stay anonymous — no sign-in needed there.
        </Text>
        {phase === "sent" || phase === "checking" ? (
          <VStack align="stretch" spacing={2}>
            <Text fontSize="sm">
              Check your email — tap the <b>Sign in to OpenQ</b> button there,
              or type the 6-digit code from the same email here:
            </Text>
            <HStack spacing={2}>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="6-digit code"
                inputMode="numeric"
                autoComplete="one-time-code"
                size="md"
                flex={1}
                minW={0}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229 && code.length === 6) submitCode(); }}
              />
              <Button
                colorScheme="purple"
                onClick={submitCode}
                isDisabled={code.length !== 6 || phase === "checking"}
                flexShrink={0}
              >
                {phase === "checking" ? "Checking…" : "Sign in"}
              </Button>
            </HStack>
            <Text fontSize="xs" opacity={0.6} lineHeight="1.5">
              Added OpenQ to your home screen? Request the code from inside
              that app and type it in there — the code signs in the app you
              type it in; the email button only signs in your browser.
            </Text>
            {note && <Text fontSize="xs" color="red.300">{note}</Text>}
          </VStack>
        ) : (
          <VStack align="stretch" spacing={2}>
            <HStack spacing={2}>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                aria-label="Email address"
                size="md"
                flex={1}
                minW={0}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229 && email.includes("@")) sendLink(); }}
              />
              <Button
                colorScheme="purple"
                onClick={sendLink}
                isDisabled={!email.includes("@") || phase === "sending"}
                flexShrink={0}
              >
                {phase === "sending" ? "Sending…" : "Email me a sign-in link"}
              </Button>
            </HStack>
            {note && <Text fontSize="xs" color="red.300">{note}</Text>}
          </VStack>
        )}
      </Box>
    );
  }

  return (
    <Box borderTopWidth="1px" borderColor="whiteAlpha.200" pt={3}>
      <HStack justifyContent="space-between" alignItems="center" mb={2}>
        <Text fontSize="sm" fontWeight="bold" minW={0} isTruncated>
          🔑 Signed in as {user.email}
        </Text>
        <Button size="xs" variant="ghost" color="red.300" onClick={doSignOut} flexShrink={0}>
          Sign out
        </Button>
      </HStack>
      {aliases.length > 0 && (
        <VStack align="stretch" spacing={1.5} mb={2}>
          {aliases.map((a) => (
            <HStack key={a.alias} justifyContent="space-between">
              <Text fontSize="sm" minW={0} isTruncated>u/{a.alias}</Text>
              <Button size="xs" colorScheme="purple" onClick={() => setAliasAtom(a.alias)} flexShrink={0}>
                Open my page
              </Button>
            </HStack>
          ))}
        </VStack>
      )}
      <HStack spacing={2}>
        <Input
          value={pageName}
          onChange={(e) => setPageName(e.target.value)}
          placeholder="Claim a page name — e.g. town-hall-notes"
          aria-label="Page name to claim"
          size="md"
          flex={1}
          minW={0}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229 && pageName.trim().length >= 2) doClaim(); }}
        />
        <Button
          colorScheme="purple"
          variant="outline"
          onClick={doClaim}
          isDisabled={pageName.trim().length < 2}
          flexShrink={0}
        >
          Claim page
        </Button>
      </HStack>
      {claimNote && <Text fontSize="xs" color="red.300" mt={1.5}>{claimNote}</Text>}
      <Text fontSize="xs" opacity={0.6} mt={1.5} lineHeight="1.5">
        Your page lives at u/your-name inside the app. Anyone you share the
        name with can find it, like a queue — your claim is what makes it yours.
      </Text>
    </Box>
  );
};

export default SignInPanel;
