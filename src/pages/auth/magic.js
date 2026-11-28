import { Box, Heading, Spinner, Text, VStack } from "@chakra-ui/react";
import { useRouter } from "next/router";
import React from "react";
import Layout from "../../components/layout/Layout";
import { verifySignInToken } from "../../libs/auth";

// Magic-link landing. The sign-in email's button points here with
// ?token=… — this page POSTs the token to the auth worker from JS, so
// a mail scanner merely PREFETCHING the link can't burn the single-use
// token (the scanner never runs this page's script). On success the
// session bearer is stored and we head home, signed in.
export default function MagicLanding() {
  const router = useRouter();
  const [state, setState] = React.useState("working"); // working | failed

  React.useEffect(() => {
    if (!router.isReady) return;
    const token = typeof router.query.token === "string" ? router.query.token : "";
    if (!token) { setState("failed"); return; }
    let live = true;
    verifySignInToken(token).then((r) => {
      if (!live) return;
      if (r.ok) router.replace("/");
      else setState("failed");
    });
    return () => { live = false; };
  }, [router]);

  return (
    <Layout>
      <VStack spacing={4} py={16} textAlign="center">
        {state === "working" ? (
          <>
            <Spinner size="lg" />
            <Heading size="md">Signing you in…</Heading>
          </>
        ) : (
          <>
            <Heading size="md">That sign-in link didn&apos;t work</Heading>
            <Text opacity={0.75} maxW="420px">
              Links expire in 15 minutes and can only be used once. Head
              back home and request a fresh one — or use the 6-digit code
              from the same email instead.
            </Text>
          </>
        )}
      </VStack>
      <Box h="80px" />
    </Layout>
  );
}
