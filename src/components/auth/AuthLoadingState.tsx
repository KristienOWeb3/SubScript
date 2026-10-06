import AuthSplitLayout from "./AuthSplitLayout";

interface AuthLoadingStateProps {
  activeTab: "signin" | "signup";
}

export default function AuthLoadingState({ activeTab }: AuthLoadingStateProps) {
  return (
    <AuthSplitLayout activeTab={activeTab}>
      <div className="space-y-3.5 animate-pulse" role="status">
        <span className="sr-only">Loading {activeTab === "signin" ? "sign in" : "sign up"}…</span>
        <div className="h-11 rounded-xl bg-black/10" />
        <div className="h-2.5 w-3/4 mx-auto rounded-full bg-black/10" />
        <div className="h-10 rounded-xl bg-black/10" />
        <div className="h-10 rounded-xl bg-black/10" />
      </div>
    </AuthSplitLayout>
  );
}
