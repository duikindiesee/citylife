import { useEffect, useState } from "react";
import { loadHouseBuild, type HouseBuildSession } from "../home/starterHouseBuild";
import { BuilderApp } from "./BuilderApp";

export function PlayerHouseBuilder() {
  const [session,setSession] = useState<HouseBuildSession>();
  const [error,setError] = useState<string>();
  useEffect(() => {
    let live=true;
    void loadHouseBuild().then(value => {if(live)setSession(value);})
      .catch(reason => {if(live)setError(reason instanceof Error ? reason.message : "House unavailable");});
    return () => {live=false;};
  },[]);
  if (session?.context.completed) return <main style={{padding:32}}>
    <h1>Your house is saved</h1><p>Your completed design is stored for {session.context.plotId}.</p>
    <a href="/">Return to CityLife</a>
  </main>;
  if (session) return <BuilderApp playerBuild={session} />;
  return <main style={{padding:32}}><h1>Loading your home site</h1>
    <p role={error ? "alert" : "status"}>{error ?? "Checking your paid plot…"}</p>
    {error && <button onClick={() => window.location.reload()}>Retry</button>}
    <p><a href="/">Return to CityLife</a></p>
  </main>;
}
