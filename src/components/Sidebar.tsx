// The project sidebar. It lists the project's scripts, which open in tabs,
// and its data files by name, which load into R through the console. The
// app reads no data file itself, so listing one here exposes nothing.

import { closeProject, newFile, openImport, openProjectScript } from "../lib/app";
import { useStore } from "../lib/store";
import { AppWindowIcon, FileIcon, ReportIcon, TableIcon } from "./Icons";

/** Groups paths by their folder, keeping the top level first. */
function byFolder(paths: string[]) {
  const groups = new Map<string, string[]>();
  for (const path of paths) {
    const cut = path.lastIndexOf("/");
    const folder = cut < 0 ? "" : path.slice(0, cut);
    groups.set(folder, [...(groups.get(folder) ?? []), path]);
  }
  return [...groups.entries()];
}

function ScriptIcon({ path }: { path: string }) {
  if (/\.(qmd|Rmd|rmd)$/.test(path)) return <ReportIcon size={16} />;
  if (/(^|\/)(app|ui|server)\.R$/.test(path)) return <AppWindowIcon size={16} />;
  return <FileIcon size={16} />;
}

export function Sidebar() {
  const project = useStore((state) => state.project);
  const active = useStore((state) => state.active);
  const platform = useStore((state) => state.info?.platform);
  if (!project) return null;
  const name = (path: string) => path.split("/").pop() ?? path;
  return (
    <nav className={`sidebar ${platform === "macos" ? "has-traffic-lights" : ""}`} aria-label="Project">
      <div className="sidebar-top" data-tauri-drag-region />
      <header className="project-head">
        <span className="project-mark" aria-hidden="true">
          {project.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="project-text">
          <strong>{project.name}</strong>
          <span className="muted">
            {project.scripts.length === 1 ? "1 script" : `${project.scripts.length} scripts`}
            {project.data.length > 0 && `, ${project.data.length === 1 ? "1 data file" : `${project.data.length} data files`}`}
          </span>
        </span>
      </header>
      <div className="sidebar-scroll">
        <section aria-labelledby="scripts-heading">
          <div className="sidebar-heading">
            <h2 id="scripts-heading">Scripts</h2>
            <button type="button" className="button quiet sidebar-add" onClick={newFile}>
              New
            </button>
          </div>
          {byFolder(project.scripts).map(([folder, paths]) => (
            <div key={folder || "top"} className="sidebar-group">
              {folder && <p className="sidebar-folder">{folder}</p>}
              <ul>
                {paths.map((path) => {
                  const full = `${project.root}/${path}`;
                  return (
                    <li key={path}>
                      <button type="button" className={`sidebar-row ${active === full ? "is-active" : ""}`} aria-current={active === full ? "page" : undefined} onClick={() => openProjectScript(path)}>
                        <ScriptIcon path={path} />
                        <span className="truncate">{name(path)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </section>
        {project.data.length > 0 && (
          <section aria-labelledby="data-heading">
            <div className="sidebar-heading">
              <h2 id="data-heading">Data</h2>
            </div>
            <p className="sidebar-note">Choose a file to preview it and import it into R. You see the code that reads it before it runs.</p>
            <ul>
              {project.data.map((path) => (
                <li key={path}>
                  <button type="button" className="sidebar-row" aria-label={`Import ${name(path)}`} onClick={() => openImport(`${project.root}/${path}`)}>
                    <TableIcon size={16} />
                    <span className="truncate">{path}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      <footer className="sidebar-foot">
        <button type="button" className="button quiet" onClick={() => closeProject()}>
          Close project
        </button>
      </footer>
    </nav>
  );
}
