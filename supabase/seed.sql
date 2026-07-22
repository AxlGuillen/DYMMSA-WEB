-- ============================================================================
-- SEED de la BD LOCAL de pruebas (Fase B · chore/local-e2e-supabase).
-- Lo aplica `supabase db reset`/`start` tras el baseline. SOLO local/tests:
-- un usuario de prueba para el login del E2E + fixtures deterministas mínimos.
-- NADA de datos reales de producción (los tests afirman contra estos valores).
-- ============================================================================

-- ─── Usuario de prueba (para el login del E2E) ──────────────────────────────
-- La app solo tiene /login (no hay signup): el usuario se siembra directo en
-- auth. Password bcrypt vía pgcrypto. email_confirmed_at seteado → puede entrar
-- sin confirmar correo. Credenciales: test@dymmsa.local / testpassword123
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-0000000000a1',
  'authenticated', 'authenticated',
  'test@dymmsa.local',
  crypt('testpassword123', gen_salt('bf')),
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  '', '', '', ''
);

INSERT INTO auth.identities (
  provider_id, user_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at
) VALUES (
  '00000000-0000-0000-0000-0000000000a1',
  '00000000-0000-0000-0000-0000000000a1',
  '{"sub":"00000000-0000-0000-0000-0000000000a1","email":"test@dymmsa.local"}'::jsonb,
  'email', now(), now(), now()
);

-- ─── Fixtures de negocio (deterministas) ────────────────────────────────────
-- Escenario que ejercita: match de catálogo + Desc. DYMMSA, los tres estados de
-- is_sold, split de inventario al crear la orden, y mayoreo/menudeo/local en el
-- planificador según STD.
--
--  ETM            model  marca   precio is_sold  catálogo(STD)  stock  gaveta
--  SEED-URREA-1   60001  URREA   100    true     sí (10)        5      Gaveta S1
--  SEED-URREA-2   60002  URREA    50    true     sí (6)         0      -
--  SEED-SURTEK-1  60003  SURTEK   30    null     sí (1)         0      -
--  SEED-NOSELL    60004  URREA    -     false    no             0      -
--  SEED-LOCAL     60005  TRUPER   25    true     no             0      -

INSERT INTO public.etm_products (etm, description, description_es, model_code, price, brand, is_sold, dymmsa_description) VALUES
  ('SEED-URREA-1','Copper punch 30mm','Botador de cobre 30mm','60001',100,'URREA',true,NULL),
  ('SEED-URREA-2','Locking pliers 10in','Pinza de presion 10"','60002', 50,'URREA',true,NULL),
  ('SEED-SURTEK-1','Tape measure 5m','Cinta metrica 5m','60003', 30,'SURTEK',NULL,NULL),
  ('SEED-NOSELL','Item we do not sell','No lo vendemos','60004',NULL,'URREA',false,NULL),
  ('SEED-LOCAL','Local buy no catalog','Compra local sin catalogo','60005', 25,'TRUPER',true,'Herramienta local (curada)');

-- Catálogo URREA: solo 60001/60002/60003 (60005 queda FUERA → compra local).
INSERT INTO public.urrea_catalog (code, brand, description, std) VALUES
  ('60001','URREA','Botador de cobre 30/300mm (oficial URREA)',10),
  ('60002','URREA','Pinza de presion 10" (oficial URREA)',6),
  ('60003','SURTEK','Cinta metrica 5m (oficial SURTEK)',1);

-- Inventario: solo 60001 con stock (para el split al crear la orden) + gaveta.
INSERT INTO public.store_inventory (model_code, quantity, location) VALUES
  ('60001',5,'Gaveta S1');
