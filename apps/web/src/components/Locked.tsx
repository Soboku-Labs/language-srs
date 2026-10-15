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
  const { isSignedIn } = useAuth();
  const tier = tierFor({ signedIn: isSignedIn });
  return { tier, can: (feature: FeatureId) => canUse(feature, tier) };
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
  const { navigate } = useRouter();

  if (can(feature)) return <>{children}</>;

  const { name, line } = FEATURES[feature];

  return (
    <div className="locked">
      <span className="locked__name">{name}</span>
      <Caption>{line}</Caption>
      <Caption>
        Needs a free account — an email and a password, nothing else, no card.
      </Caption>
      <TextButton label="Create an account" onClick={() => navigate('/sign-in')} />
    </div>
  );
}
