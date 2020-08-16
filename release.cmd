@echo off
set VER=1.2.2

sed -i -E "s/version>.+?</version>%VER%</" classic\install.rdf
sed -i -E "s/version>.+?</version>%VER%</; s/download\/.+?\/(.+?)classic-.+?\.xpi/download\/%VER%\/\1classic-%VER%\.xpi/" update.xml

sed -i -E "s/\"version\": \".+?\"/\"version\": \"%VER%\"/" quantum\manifest.json
sed -i -E "s/\"version\": \".+?\"/\"version\": \"%VER%\"/; s/tag\/.+?\"/tag\/%VER%\"/; s/download\/.+?\/(.+?)quantum-.+?\.xpi/download\/%VER%\/\1quantum-%VER%\.xpi/" update.json

set XPI=scriptlet-doctor-classic-%VER%.xpi
if exist %XPI% del %XPI%
pushd classic
..\zip -r9q ..\%XPI% .
popd

set XPI=scriptlet-doctor-unsigned-quantum-%VER%.xpi
if exist %XPI% del %XPI%
pushd quantum
..\zip -r9q ..\%XPI% .
popd
