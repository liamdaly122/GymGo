import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNextBlockRotation } from '@/db/queries';
import { startNextBlock } from '@/db/mutations';
import { Button, Toggle } from '@/components/ui';

/**
 * Starting the next block, with what it will change in view first.
 *
 * The main lifts stay and the accessories rotate. The list is what starting
 * will actually do — preview and mutation work it out from the same rule —
 * and the switch keeps this block's accessories for anyone who likes them.
 */
export default function NextBlockPanel({ planId, blockWeeks }: { planId: string; blockWeeks: number }) {
  const navigate = useNavigate();
  const changes = useNextBlockRotation(planId);
  const [rotate, setRotate] = useState(true);
  const [showChanges, setShowChanges] = useState(false);
  const [starting, setStarting] = useState(false);

  const handleStart = async () => {
    setStarting(true);
    await startNextBlock(planId, { rotate });
    void navigate('/');
  };

  const count = changes?.length ?? 0;

  return (
    <div className="stack-sm">
      <p className="t-meta">
        The next block runs the same sessions for another {blockWeeks} weeks and keeps your main
        lifts. Your weights carry over, so suggestions pick up where this block left off.
      </p>

      {count > 0 ? (
        <>
          <Toggle
            label="Rotate accessories"
            hint={
              rotate
                ? `${count} ${count === 1 ? 'accessory changes' : 'accessories change'} to another version of the same lift.`
                : 'Every exercise stays as it is.'
            }
            checked={rotate}
            onChange={setRotate}
          />
          {rotate ? (
            <button
              type="button"
              className="btn-text self-start"
              aria-expanded={showChanges}
              aria-controls="next-block-changes"
              onClick={() => setShowChanges((open) => !open)}
            >
              {showChanges ? 'Hide what changes' : 'See what changes'}
            </button>
          ) : null}
          {rotate && showChanges ? (
            <ul id="next-block-changes" className="flex flex-col gap-2" aria-label="Accessories that change">
              {changes!.map((change) => (
                <li key={change.rowId} className="text-sm">
                  <span className="t-label block">{change.session}</span>
                  {change.from} → <span className="text-hot">{change.to}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}

      <Button variant="primary" block disabled={starting} onClick={() => void handleStart()}>
        Start the next block
      </Button>
    </div>
  );
}
