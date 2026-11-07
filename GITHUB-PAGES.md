# GitHub Pages 공개

1. GitHub 계정에 `k-fountain` 공개 저장소를 만들고 이 폴더의 파일을 올립니다. 숨김 폴더 `.github`도 포함합니다.
2. 저장소 Settings → Pages → Source에서 **GitHub Actions**를 선택합니다.
3. Actions → Publish K-Fountain에서 실행 결과를 확인합니다. `main`에 파일을 올릴 때마다 검사 후 자동 배포합니다.
4. 배포가 완료되면 Pages에 표시되는 주소를 공유합니다.

빌드 결과인 `dist` 폴더만 웹에 배포합니다. 원고는 사용자의 브라우저에 저장되며 서버에 업로드하지 않습니다. 사용자는 `K-파운틴.html` 주소에서 단일 파일 편집기를 내려받을 수도 있습니다.

원본 fountain2html의 Apache-2.0 라이선스와 글꼴·라이브러리 고지는 `vendor/fountain2html/LICENSE`와 빌드 결과의 `THIRD-PARTY-NOTICES.txt`에 보존됩니다.
