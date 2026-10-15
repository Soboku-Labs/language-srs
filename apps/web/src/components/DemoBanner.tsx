import { useAuth } from '../providers';
import { useRouter } from '../router';

/**
 * A standing reminder that this is the demo.
 *
 * The demo opens every account-only feature, which means somebody who forgets
 * they are in it would reasonably conclude their work is being kept — and
 * nothing here is kept anywhere but this browser. An app that lets that
 * misunderstanding stand has not demonstrated anything, it has misled someone.
 *
 * So it is always on screen rather than shown once and dismissed, it names
 * what is and is not true, and the way out is in it. Deliberately quiet: this
 * is a state, not an error, and a red bar across the top of a product somebody
 * is evaluating says the wrong thing about the product.
 */
export function DemoBanner() {
  const { demo, signOut } = useAuth();
  const { navigate } = useRouter();

  if (!demo) return null;

  return (
    <div className="demo" role="status">
      <span className="demo__label">Demo</span>
      <span className="demo__line">
        Everything an account unlocks, open to look at. Nothing is saved to an account, and
        nothing leaves this browser.
      </span>
      <button
        type="button"
        className="demo__out"
        onClick={() => {
          // Leaving drops the demo's own storage slice out of use; a real
          // profile on this device is under a different prefix and untouched.
          void signOut().then(() => navigate('/sign-in?new=1'));
        }}
      >
        Make a real account
      </button>
    </div>
  );
}
