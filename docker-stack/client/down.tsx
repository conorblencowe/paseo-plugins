import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal, useToast } from "@getpaseo/plugin/client/ui";
import { useMutation } from "@tanstack/react-query";
import { Pressable, Text, View } from "react-native";
import { downRpc } from "../shared/docker";
import { refreshSidebarIndicators } from "./web";

// Runs `compose down` for the stack started in a directory; the argument is that directory.
export function useDownStack(onSettled: () => void) {
  const toast = useToast();
  const downStack = useRpc(downRpc);
  return useMutation({
    mutationFn: (directory: string) => downStack({ directory }),
    onSuccess: () => toast.show("Docker stack is down", { variant: "success" }),
    onError: (error) => toast.error(error.message),
    onSettled: () => {
      onSettled();
      refreshSidebarIndicators();
    },
  });
}

const button = {
  height: 28,
  flexDirection: "row" as const,
  alignItems: "center" as const,
  gap: 4,
  paddingHorizontal: 12,
  borderRadius: 6,
};

// Open while `project` is set.
export function ConfirmDownModal({
  theme,
  project,
  onConfirm,
  onClose,
}: {
  theme: PluginTheme;
  project: string | null;
  onConfirm(): void;
  onClose(): void;
}) {
  const c = theme.colors;
  return (
    <Modal
      title="Down Docker stack?"
      icon={<Icon name="TriangleAlert" size={18} color={c.statusWarning} />}
      open={project !== null}
      onOpenChange={(open) => !open && onClose()}
    >
      <Modal.Content>
        <Text style={{ fontSize: 14, lineHeight: 20, color: c.foreground }}>
          Runs docker compose down for {project}: stops and removes its containers and networks. Volumes
          are kept.
        </Text>
        <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
          <Pressable accessibilityRole="button" style={button} onPress={onClose}>
            <Text style={{ fontSize: 12, color: c.foregroundMuted }}>Cancel</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            style={[button, { backgroundColor: c.accent }]}
            onPress={() => {
              onClose();
              onConfirm();
            }}
          >
            <Icon name="Square" size={14} color={c.accentForeground} />
            <Text style={{ fontSize: 12, fontWeight: "500", color: c.accentForeground }}>Down</Text>
          </Pressable>
        </View>
      </Modal.Content>
    </Modal>
  );
}
