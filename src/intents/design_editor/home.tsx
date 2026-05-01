import { Rows } from "@canva/app-ui-kit";
import { Outlet } from "react-router-dom";
import * as styles from "styles/components.css";
import { AppError } from "src/components/app_error";

export const Home = () => (
  <div className={styles.scrollContainer}>
    <Rows spacing="2u">
      <AppError />
      <Outlet />
    </Rows>
  </div>
);
