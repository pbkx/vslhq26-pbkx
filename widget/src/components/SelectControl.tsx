import * as SelectPrimitive from "@radix-ui/react-select";

export type SelectOption = {
  value: string;
  label: string;
};

function Chevron({ direction = "down" }: { direction?: "up" | "down" }) {
  return (
    <svg className="select-chevron" viewBox="0 0 16 16" aria-hidden="true">
      <path d={direction === "down" ? "m4 6 4 4 4-4" : "m4 10 4-4 4 4"} />
    </svg>
  );
}

function Checkmark() {
  return (
    <svg className="select-check" viewBox="0 0 16 16" aria-hidden="true">
      <path d="m3.5 8 3 3 6-6" />
    </svg>
  );
}

export function SelectControl({
  value,
  options,
  onValueChange,
  ariaLabel,
  className = "",
  disabled = false,
}: {
  value: string;
  options: SelectOption[];
  onValueChange: (value: string) => void;
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <SelectPrimitive.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectPrimitive.Trigger
        className={`select-trigger ${className}`}
        aria-label={ariaLabel}
        disabled={disabled}
      >
        <SelectPrimitive.Value />
        <SelectPrimitive.Icon asChild>
          <Chevron />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          className="select-content"
          position="popper"
          sideOffset={4}
          collisionPadding={8}
        >
          <SelectPrimitive.ScrollUpButton className="select-scroll-button">
            <Chevron direction="up" />
          </SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport className="select-viewport">
            {options.map((option) => (
              <SelectPrimitive.Item className="select-item" value={option.value} key={option.value}>
                <span className="select-indicator">
                  <SelectPrimitive.ItemIndicator>
                    <Checkmark />
                  </SelectPrimitive.ItemIndicator>
                </span>
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
          <SelectPrimitive.ScrollDownButton className="select-scroll-button">
            <Chevron />
          </SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
