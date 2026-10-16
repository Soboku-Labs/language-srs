import { FEATURES, canUse, tierFor, type FeatureId } from '@language-srs/core';
import type { ReactNode } from 'react';
import { useAuth } from '../providers';
import { useRouter } from '../router';
import { Caption, TextButton } from '../ui';

/**
 * What this learner can reach.
 *
 * One hook, so no screen decides for itself what an account is for. `paid` is
 * wired to `false` and typed anyway — practice books are the planned third
 * tier, and the difference between this and a boolean is whether adding them
 * is one line or a rewrite.
 */
export function useAccess() {
  const { synced, demo, canSignIn } = useAuth();

  /*
   * An account, or the demo — not merely "has a local profile".
   *
   * This read `isSignedIn`, which is true for a *device profile* as well:
   * pressing "Use this device", which creates no account and sends nothing
   * anywhere, opened every gate. The whole thing was decorative, and silently
   * so, because the locks still appeared for somebody who had not chosen
   * anything yet — which is the state anybody testing it would be in.
   *
   * `synced` is the honest test: there is a token, so there is an account on
   * a server. The demo is the one deliberate exception, and it says so on
   * screen the entire time it is on.
   */
  /*
   * A build with no server does not gate, because it cannot ungate.
   *
   * The deployed site has no `VITE_API_URL`, so there is no account to make —
   * and it was still showing every lock. The sequence was: a learner reaches
   * "Your own word lists · Needs a free account — an email and a password,
   * nothing else, no card", presses Create an account, and arrives at a page
   * with no fields on it saying this build has no server. The product
   * promised something it had no way to provide.
   *
   * Everything behind these gates works locally anyway; `sync` is the only
   * one that genuinely needs a server, and it is already impossible without
   * one. So where there is no backend the features are simply open, and the
   * moment an API is configured the gates come back without anybody changing
   * this file.
   */
  const tier = tierFor({ signedIn: synced || demo || !canSignIn });
  return { tier, can: (feature: FeatureId) => canUse(feature, tier), demo };
}

/**
 * A feature behind an account, shown rather than hidden.
 *
 * The rule this component exists to enforce is that a gate is **reached, not
 * hit**. It renders in the flow of the page, where the feature would have
 * been, saying what it is and what it would do. It is never a dialog over
 * something somebody was already doing, and it never appears during a review —
 * interrupting a study session to ask for an email is how an app teaches
 * people that studying is the thing that costs them.
 *
 * It also says the price, because the price is nothing. Leaving that implied
 * is how a free sign-up reads as a paywall: people have learned that a lock
 * means money, and the only way to say otherwise is to say it.
 */
export function Locked({
  feature,
  children,
}: {
  feature: FeatureId;
  /** Rendered instead of the lock when the learner can use it. */
  children: ReactNode;
}) {
  const { can } = useAccess();
  const { navigate, path } = useRouter();

  if (can(feature)) return <>{children}</>;

  const { name, line } = FEATURES[feature];

  return (
    <div className="locked">
      <span className="locked__name">{name}</span>
      <Caption>{line}</Caption>
      <Caption>
        Needs a free account — an email and a password, nothing else, no card.
      </Caption>
      {/* `new=1` because this one really does mean make an account, and
          `from` so somebody who came here to import a word list is returned
          to the import screen rather than to the front door. */}
      <TextButton
        label="Create an account"
        onClick={() => navigate(`/sign-in?new=1&from=${encodeURIComponent(path)}`)}
      />
    </div>
  );
}
