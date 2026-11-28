import { ArrowRightIcon, CloseIcon, MoonIcon, SunIcon } from "@chakra-ui/icons";
import { Box, HStack, IconButton, Input, Text, VStack, useColorMode } from "@chakra-ui/react";
import { useAtom } from "jotai";
import { motion } from "framer-motion";
import { useRouter } from 'next/router';
import React from "react";
import { useFocus, useRelayOfflineConfirmed } from "../../libs/hooks";
import { alertMsgAtom, aliasAtom, threadIdAtom } from "../../libs/jotaiAtoms";
import Logo, { LogoMark } from "../Logo";
import SignInPanel from "../SignInPanel";
import ThoughtHeapButton from "../ThoughtHeap";

// Relay status: silent when healthy — the green dot was always on, pure
// noise. Only speaks up on CONFIRMED failure (offline for 5s+): a pulsing
// red "Offline" pill. (Still checking / healthy → render nothing.)
const RelayStatus = () => {
  const offline = useRelayOfflineConfirmed();
  if (!offline) return null;
  return (
    <Box
      display="flex" alignItems="center" gap={1.5} px={2.5} py={1}
      borderRadius="full" bg="red.500" color="white"
      fontSize="xs" fontWeight="bold" flexShrink={0}
      title="Couldn't reach the relay — your posts stay on this device only"
      aria-label="relay connection failed"
    >
      <motion.span
        style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "#fff" }}
        animate={{ opacity: [1, 0.25, 1] }}
        transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
      />
      Offline
    </Box>
  );
};

const Header = () => {
  const router = useRouter();
  const [alias, setAliasAtom] = useAtom(aliasAtom);
  const [alertMsg, setAlertMsg] = useAtom(alertMsgAtom);
  const [thread, setThreadIdAtom] = useAtom(threadIdAtom);

  const { toggleColorMode, colorMode } = useColorMode();
  const [username, setUsernameState] = React.useState('');
  const [usernameRef, setInputUsernameFocus] = useFocus()

  React.useEffect(() => {
    setInputUsernameFocus();
  }, [setInputUsernameFocus]);

  const setThread = () => setThreadIdAtom(username.replace(/ /g, ''));
  const exitThread = React.useCallback(() => {
    setThreadIdAtom('');
    setAliasAtom('');
    setUsernameState('');
  }, [setThreadIdAtom, setAliasAtom]);

  React.useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        exitThread()
      }
    }
    document.addEventListener('keydown', handleKeyDown);

    // Don't forget to clean up
    return function cleanup() {
      document.removeEventListener('keydown', handleKeyDown);
    }
  }, [exitThread]);

  React.useEffect(() => {
    // strip any query string (e.g. ?present=1) before treating the path as a room id
    const secret = router.asPath.split('?')[0].slice(1);

    if (secret) {
      setThreadIdAtom(secret);
    }
  }, [router.asPath, setThreadIdAtom]);

  const setUsername = (e) => setUsernameState(e.target.value);

  const ToggleColor = () => <IconButton
    variant={"ghost"}
    color={colorMode === "light" ? "blue.400" : 'yellow.300'}
    aria-label="toggle ColorMode"
    icon={colorMode === "light" ? <MoonIcon /> : <SunIcon />}
    onClick={toggleColorMode}
  />;

  const handleEnterShortSecret = (event) => event.key === 'Enter' && setThread();

  // Joined input group: room-name input with the » button attached at its
  // right end (search-bar style). The button's -1px overlap + square inner
  // corners make them read as one control; it can never wrap onto its own
  // row, which was the mobile shrink-to-fit trigger.
  const roomEntry = (
    <VStack w="100%" spacing={1.5} align="stretch">
      <HStack spacing={0} w="100%">
        <Input
          ref={usernameRef}
          value={username}
          placeholder="Queue name — e.g. town-hall"
          onChange={setUsername}
          onKeyDown={handleEnterShortSecret}
          size="lg"
          flex={1}
          minW={0}
          borderRightRadius={0}
          position="relative"
          _focus={{ zIndex: 1 }}
        />
        <IconButton
          aria-label="join the queue"
          title="Join the queue — no signup needed"
          isDisabled={!username.length || !!alertMsg.length}
          variant="solid"
          colorScheme="green"
          onClick={setThread}
          icon={<ArrowRightIcon />}
          size="lg"
          minW="56px"
          minH="48px"
          borderLeftRadius={0}
          ml="-1px"
          flexShrink={0}
        />
      </HStack>
      <Text fontSize="xs" opacity={0.6} px={1} lineHeight="1.5">
        💡 Type a queue name and hit <b>→</b> to join the discussion. No signup, no app.
      </Text>
    </VStack>
  );

  // On your private page (alias set by the sign-in panel) the header
  // collapses exactly like it does inside a queue.
  const onOwnPage = !!alias;

  // In a room (or on your private page) the header collapses to ONE slim
  // row of controls only. The room name no longer lives up here — it gets
  // its own hero section below (RoomHeader), so it never competes with the
  // header buttons for space on narrow screens.
  const compactBar = (
    <HStack spacing={1} w="100%" alignItems="center" justifyContent="space-between">
      <Box onClick={exitThread} cursor="pointer" flexShrink={0} lineHeight={0}
        aria-label="back to home" title={thread ? `Back to home (queue: ${thread})` : "Back to home"}>
        <LogoMark size={26} />
      </Box>
      <HStack spacing={0} alignItems="center">
        <ThoughtHeapButton />
        <RelayStatus />
        <ToggleColor />
        <IconButton
          variant="ghost"
          onClick={exitThread}
          color="red.400"
          icon={<CloseIcon />}
          aria-label={onOwnPage ? "leave page" : "exit queue"}
          flexShrink={0}
        />
      </HStack>
    </HStack>
  );

  return (
    <Box as={"header"} mb={3} position="sticky" top={2} zIndex={20}>
      <VStack
        layerStyle="glass"
        borderRadius="2xl"
        p={onOwnPage || thread ? 2 : 3}
        spacing={3}
        align="stretch"
      >
        {onOwnPage || thread ? compactBar : (
          <>
            {/* Row 1: brand lockup left, status controls right */}
            <HStack justifyContent="space-between" alignItems="center" w="100%" spacing={2}>
              <Logo size={30} wordmark onClick={exitThread} />
              <HStack spacing={0} flexShrink={0}>
                <ThoughtHeapButton />
                <RelayStatus />
                <ToggleColor />
              </HStack>
            </HStack>
            {/* Row 2: room entry */}
            {roomEntry}
            {/* Row 3: email sign-in + private page ownership */}
            <SignInPanel />
          </>
        )}
      </VStack>
    </Box>
  );
};

export default Header;
