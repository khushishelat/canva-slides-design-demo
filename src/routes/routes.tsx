import { Home } from "src/intents/design_editor/home";
import { DeckPage } from "src/pages/deck";
import { ErrorPage } from "src/pages/error";
import { FactsPage } from "src/pages/facts";
import { HomePage } from "src/pages/home";
import { ImagesPage } from "src/pages/images";
import { Paths } from "src/routes/paths";

export const routes = [
  {
    path: Paths.HOME,
    element: <Home />,
    errorElement: <ErrorPage />,
    children: [
      { index: true, element: <HomePage /> },
      { path: Paths.DECK, element: <DeckPage /> },
      { path: Paths.FACTS, element: <FactsPage /> },
      { path: Paths.IMAGES, element: <ImagesPage /> },
    ],
  },
];
