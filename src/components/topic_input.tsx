import {
  Button,
  FormField,
  MultilineInput,
  Rows,
  Text,
  Badge,
  Columns,
  Column,
} from "@canva/app-ui-kit";
import { useAppContext } from "src/context/use_app_context";

const PRESET_TOPICS = [
  "Global EV market growth 2024-2025",
  "Generative AI spend by Fortune 500",
  "US marketing AI adoption 2025",
];

type Props = {
  label?: string;
  placeholder?: string;
  ctaLabel: string;
  onSubmit: (topic: string) => void;
  disabled?: boolean;
  loading?: boolean;
  /** Optional second CTA. Renders as a tertiary button beneath the primary. */
  secondaryCta?: {
    label: string;
    onSubmit: (topic: string) => void;
    helperText?: string;
  };
};

export function TopicInput({
  label = "What should Parallel research?",
  placeholder = 'e.g. "Global EV market growth and adoption 2024-2025"',
  ctaLabel,
  onSubmit,
  disabled,
  loading,
  secondaryCta,
}: Props) {
  const { topicInput, setTopicInput } = useAppContext();

  const handleSubmit = () => {
    if (!topicInput.trim()) return;
    onSubmit(topicInput.trim());
  };

  return (
    <Rows spacing="1u">
      <FormField
        label={label}
        control={(props) => (
          <MultilineInput
            {...props}
            value={topicInput}
            onChange={setTopicInput}
            placeholder={placeholder}
            minRows={2}
            maxRows={3}
          />
        )}
      />

      {!topicInput && (
        <Rows spacing="0.5u">
          <Text size="small" tone="tertiary">
            Try a preset:
          </Text>
          <Columns spacing="0.5u" alignY="center">
            {PRESET_TOPICS.map((preset) => (
              <Column key={preset} width="content">
                <div
                  onClick={() => setTopicInput(preset)}
                  style={{ cursor: "pointer" }}
                >
                  <Badge tone="assist" text={preset} />
                </div>
              </Column>
            ))}
          </Columns>
        </Rows>
      )}

      <Button
        variant="primary"
        onClick={handleSubmit}
        disabled={disabled || !topicInput.trim()}
        loading={loading}
        stretch
      >
        {ctaLabel}
      </Button>

      {secondaryCta && (
        <Rows spacing="0.5u">
          <Button
            variant="secondary"
            onClick={() => {
              if (!topicInput.trim()) return;
              secondaryCta.onSubmit(topicInput.trim());
            }}
            disabled={disabled || !topicInput.trim()}
            loading={loading}
            stretch
          >
            {secondaryCta.label}
          </Button>
          {secondaryCta.helperText && (
            <Text size="small" tone="tertiary">
              {secondaryCta.helperText}
            </Text>
          )}
        </Rows>
      )}
    </Rows>
  );
}
