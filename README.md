# Olympia

Aplicação estática para acompanhar o Notebook e as divisões de musculação da planilha Workout.

## Repositórios

- `GabrielSpina/olympia` (público): os arquivos de `web/` e o fluxo de publicação.
- `GabrielSpina/olympia-dados` (privado): `notebook.json` e `treinos.json`, importados da planilha. Não publicar estes arquivos no repositório público.

## Uso

Abra o site publicado no GitHub Pages. Em **Dados**, conecte um token pessoal *fine-grained* limitado ao repositório `olympia-dados`, com permissão **Contents: Read and write**. O token fica em `sessionStorage`, somente até fechar a sessão do navegador. O app lê os JSON privados pela API do GitHub e grava cada marcação `Fiz` ou `Não fiz` no Notebook, preservando as demais linhas. Em caso de alteração simultânea, tenta novamente com a versão mais recente.

É possível importar os dois JSON manualmente para testar sem token. Neste modo, as marcações ficam no `localStorage` do navegador e não são enviadas ao GitHub.

A sincronização bidirecional com o Google Sheets ainda será uma etapa separada. As linhas importadas guardam `sourceRow` para permitir correspondência futura.

## Desenvolvimento

Para visualizar localmente, sirva a pasta `web/` com um servidor HTTP estático. A interface não exige compilação ou dependências de JavaScript.

