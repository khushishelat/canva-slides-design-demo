import { Button, Rows, Text } from "@canva/app-ui-kit";
import { useNavigate } from "react-router-dom";
import { useAppContext } from "src/context/use_app_context";
import { Paths } from "src/routes/paths";
import * as styles from "styles/components.css";

export const ErrorPage = () => {
  const navigate = useNavigate();
  const { setAppError, setTopicInput } = useAppContext();

  const onClick = () => {
    setAppError("");
    setTopicInput("");
    navigate(Paths.HOME);
  };

  return (
    <div className={styles.scrollContainer}>
      <Rows spacing="2u">
        <Text>Something went wrong.</Text>
        <Button variant="primary" onClick={onClick} stretch>
          Start over
        </Button>
      </Rows>
    </div>
  );
};
