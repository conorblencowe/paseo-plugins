import { type PluginSurfaceProps, useRpc } from "@getpaseo/plugin/client";
import {
  ExternalLink,
  SettingsAction,
  SettingsCard,
  type SettingsInputHandle,
  SettingsInput,
  SettingsRow,
  SettingsSection,
} from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Text, View } from "react-native";
import { accountRpc, signInRpc, signOutRpc } from "../shared/buildkite";
import { expiryWarning } from "../shared/token";
import { FONT, SPACE, TOKEN_URL } from "./ui";

export function BuildkiteSettings({ theme }: PluginSurfaceProps) {
  const getAccount = useRpc(accountRpc);
  const signIn = useRpc(signInRpc);
  const signOut = useRpc(signOutRpc);
  const queryClient = useQueryClient();
  const account = useQuery({ queryKey: ["buildkite-account"], queryFn: () => getAccount({}) });
  const input = useRef<SettingsInputHandle>(null);
  const [draft, setDraft] = useState("");
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["buildkite-account"] }),
      queryClient.invalidateQueries({ queryKey: ["buildkite-status"] }),
    ]);
  const save = useMutation({
    mutationFn: () => signIn({ token: draft }),
    onSuccess: async () => {
      input.current?.replaceText("");
      setDraft("");
      await refresh();
    },
  });
  const remove = useMutation({ mutationFn: () => signOut({}), onSuccess: refresh });
  const muted = { fontSize: FONT.sm, color: theme.colors.foregroundMuted };

  const data = account.data;
  const connected = data?.signedIn === true;
  const canRetry = connected && data.scopes.includes("write_builds");

  return (
    <View style={{ gap: SPACE[6] }}>
      <SettingsSection title="Buildkite account">
        <SettingsCard>
          {account.error ? (
            <SettingsRow label="Could not check the account" error={account.error.message} />
          ) : !data ? (
            <SettingsRow label="Checking…" />
          ) : !data.signedIn ? (
            <SettingsRow label="Not connected" hint="Add an API access token below." />
          ) : data.error ? (
            <SettingsRow label="Token not accepted" error={data.error} />
          ) : (
            <SettingsRow
              label={data.name ? `Connected as ${data.name}` : "Connected"}
              hint={data.email ?? undefined}
            />
          )}
          {connected && !data.error ? (
            <SettingsRow
              label="Token"
              error={expiryWarning(data.expiresAt)}
              hint={[
                data.description,
                data.expiresAt ? `Expires ${new Date(data.expiresAt).toLocaleDateString()}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            >
              <Text style={muted}>{data.scopes.join(", ")}</Text>
            </SettingsRow>
          ) : null}
          {connected && !data.error ? (
            <SettingsRow
              label="Retry steps"
              hint={canRetry ? "Allowed" : "Needs a token with the write_builds scope"}
            />
          ) : null}
          {connected ? (
            <SettingsAction
              label="Sign out"
              hint="Deletes the token stored on this Paseo host."
              actionLabel="Sign out"
              disabled={remove.isPending}
              onPress={() => remove.mutate()}
            />
          ) : null}
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={connected ? "Replace token" : "Connect"}>
        <SettingsCard>
          <SettingsInput
            ref={input}
            label="API access token"
            hint="Needs read_builds and read_build_logs. Add write_builds to retry steps."
            placeholder="bkua_…"
            secureTextEntry
            onChangeText={setDraft}
            error={save.error?.message ?? null}
          />
          <SettingsAction
            label="Save token"
            hint="Buildkite checks the token's scopes before it is saved."
            actionLabel={save.isPending ? "Checking…" : "Save"}
            disabled={!draft.trim() || save.isPending}
            onPress={() => save.mutate()}
          />
        </SettingsCard>
        <View style={{ paddingTop: SPACE[2] }}>
          <ExternalLink href={TOKEN_URL}>Create a token on buildkite.com</ExternalLink>
        </View>
      </SettingsSection>
    </View>
  );
}
