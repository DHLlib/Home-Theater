import { Drawer } from "vaul";

export interface ActionSheetAction {
  key: string;
  label: string;
  danger?: boolean;
  onClick: () => void;
}

interface ActionSheetProps {
  open: boolean;
  title?: string;
  actions: ActionSheetAction[];
  onClose: () => void;
}

export default function ActionSheet({
  open,
  title,
  actions,
  onClose,
}: ActionSheetProps) {
  return (
    <Drawer.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
      direction="bottom"
    >
      <Drawer.Portal>
        <Drawer.Overlay
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.6)",
            zIndex: 950,
          }}
        />
        <Drawer.Content
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 951,
            display: "flex",
            flexDirection: "column",
            background: "var(--bg-elevated)",
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            border: "1px solid var(--glass-border)",
            borderBottom: "none",
            paddingBottom: "env(safe-area-inset-bottom)",
          }}
        >
          <div
            style={{
              flexShrink: 0,
              padding: "12px 16px 8px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Drawer.Handle
              style={{
                width: 40,
                height: 4,
                borderRadius: 2,
                background: "var(--text-muted)",
              }}
            />
          </div>
          {title && (
            <div
              style={{
                padding: "0 16px 8px",
                fontSize: 13,
                color: "var(--text-secondary)",
              }}
            >
              {title}
            </div>
          )}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              padding: "0 16px 16px",
            }}
          >
            {actions.map((action, idx) => (
              <button
                key={action.key}
                type="button"
                className="btn"
                onClick={() => {
                  action.onClick();
                  onClose();
                }}
                style={{
                  justifyContent: "flex-start",
                  minHeight: 48,
                  borderRadius: idx === 0 ? "8px 8px 0 0" : 0,
                  border: "none",
                  borderBottom: `1px solid var(--glass-border)`,
                  color: action.danger ? "var(--danger)" : undefined,
                }}
              >
                {action.label}
              </button>
            ))}
            <button
              type="button"
              className="btn"
              onClick={onClose}
              style={{ marginTop: 8, minHeight: 48, borderRadius: 8 }}
            >
              取消
            </button>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
