import { Users } from 'lucide-react';
import { requirePermission } from '@/lib/auth/guards';
import { listCrewsWithMembers } from '@/lib/services/crews';
import { listMembers } from '@/lib/data/jobs';
import { Badge, Card, CardBody, CardHeader, EmptyState, Field, Input, PageHeader } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { createCrewAction, deleteCrewAction, setCrewMembersAction } from '@/app/(app)/ekipy/actions';

export const metadata = { title: 'Ekipy' };

export default async function CrewsPage() {
  const context = await requirePermission('job:read');
  const [crews, members] = await Promise.all([
    listCrewsWithMembers(context.organization.id),
    listMembers(context.organization.id),
  ]);

  return (
    <>
      <PageHeader title="Ekipy" description="Składy ekip — kolizje terminów wykrywamy na poziomie ekipy." />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {crews.length === 0 ? (
            <Card>
              <EmptyState
                title="Brak ekip"
                description="Utwórz ekipę, żeby planować zlecenia i wykrywać kolizje terminów."
              />
            </Card>
          ) : (
            crews.map((crew) => (
              <Card key={crew.id}>
                <CardHeader
                  title={
                    <span className="flex items-center gap-2">
                      <span className="h-3 w-3 rounded-full" style={{ backgroundColor: crew.color }} />
                      {crew.name}
                    </span>
                  }
                  description={crew.description ?? undefined}
                />
                <CardBody className="space-y-3">
                  <p className="text-sm text-ink-600">
                    Skład: {crew.memberIds.length === 0 ? 'brak osób' : `${crew.memberIds.length} osób`}
                  </p>

                  {context.can('job:assign') ? (
                    <form action={setCrewMembersAction} className="space-y-2">
                      <input type="hidden" name="crewId" value={crew.id} />
                      <div className="grid gap-1 sm:grid-cols-2">
                        {members.map((member) => (
                          <label key={member.userId} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-ink-50">
                            <input
                              type="checkbox"
                              name="memberIds"
                              value={member.userId}
                              defaultChecked={crew.memberIds.includes(member.userId)}
                              className="h-4 w-4 rounded border-ink-300"
                            />
                            <span className="text-ink-800">{member.name}</span>
                            <Badge tone="neutral">{member.role}</Badge>
                          </label>
                        ))}
                      </div>
                      <SubmitButton variant="secondary" size="sm">
                        Zapisz skład
                      </SubmitButton>
                    </form>
                  ) : (
                    <ul className="flex flex-wrap gap-1">
                      {crew.memberIds.map((memberId) => {
                        const member = members.find((item) => item.userId === memberId);
                        return member ? (
                          <li key={memberId}>
                            <Badge tone="neutral">{member.name}</Badge>
                          </li>
                        ) : null;
                      })}
                    </ul>
                  )}

                  {context.can('job:assign') ? (
                    <form action={deleteCrewAction} className="border-t border-ink-100 pt-3">
                      <input type="hidden" name="crewId" value={crew.id} />
                      <SubmitButton variant="danger" size="sm" confirm={`Usunąć ekipę ${crew.name}?`}>
                        Usuń ekipę
                      </SubmitButton>
                    </form>
                  ) : null}
                </CardBody>
              </Card>
            ))
          )}
        </div>

        <div>
          {context.can('job:assign') ? (
            <Card>
              <CardHeader title="Nowa ekipa" />
              <CardBody>
                <form action={createCrewAction} className="space-y-3">
                  <Field label="Nazwa">
                    <Input name="name" required placeholder="Ekipa A — centrum" />
                  </Field>
                  <Field label="Kolor na kalendarzu">
                    <Input name="color" type="color" defaultValue="#337dff" className="h-10 w-16 p-1" />
                  </Field>
                  <Field label="Opis">
                    <Input name="description" placeholder="Opcjonalnie" />
                  </Field>
                  <SubmitButton className="w-full">
                    <Users className="h-4 w-4" /> Utwórz ekipę
                  </SubmitButton>
                </form>
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
