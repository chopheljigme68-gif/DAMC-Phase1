import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import { AuthProvider } from "./context/AuthContext.jsx";
import { ThemeProvider } from "./context/ThemeContext.jsx";
import AppearanceSync from "./context/AppearanceSync.jsx";
import { WorkspaceProvider } from "./context/WorkspaceContext.jsx";
import { ProjectProvider } from "./context/ProjectContext.jsx";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ThemeProvider>
      <AuthProvider>
        {/* Inside AuthProvider (needs the signed-in user), inside
            ThemeProvider (needs the appearance it keeps in step). */}
        <AppearanceSync />
        <BrowserRouter>
          <WorkspaceProvider>
            <ProjectProvider>
              <App />
            </ProjectProvider>
          </WorkspaceProvider>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  </React.StrictMode>
);