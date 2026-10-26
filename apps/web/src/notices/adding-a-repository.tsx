// The pointer to the server README's "Adding a repository", which says how to onboard a repository by hand and how to
// fix its .lar-factory.json.

const README = 'https://github.com/maddec01/lar-factory/blob/main/apps/server/README.md#adding-a-repository';

/** "See Adding a repository in apps/server/README.md.", linking to it. */
export function AddingARepository() {
  return <>See <a href={README} target="_blank" rel="noopener">Adding a repository</a> in apps/server/README.md.</>;
}
