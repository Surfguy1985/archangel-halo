import { Route, Switch } from "wouter";
import { Landing } from "./pages/Landing";
import { LiveMap } from "./pages/LiveMap";
import { FieldGuide } from "./pages/FieldGuide";
import { Messages } from "./pages/Messages";
import { RoleGate } from "./pages/RoleGate";

export function App() {
  return (
    <Switch>
      <Route path="/" component={Landing} />
      <Route path="/enter" component={RoleGate} />
      <Route path="/live" component={LiveMap} />
      <Route path="/live/:propertyId" component={LiveMap} />
      <Route path="/field" component={FieldGuide} />
      <Route path="/field/:jobId" component={FieldGuide} />
      <Route path="/messages" component={Messages} />
      <Route>
        <div className="min-h-full grid place-items-center p-8">
          <p className="text-halo-mist">Not found · <a className="text-halo-lime" href="/">Home</a></p>
        </div>
      </Route>
    </Switch>
  );
}
